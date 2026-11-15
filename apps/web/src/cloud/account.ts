/**
 * 账号服务：会话、OTP 登录/注册、微信网页登录、OAuth 回调分发、登出。
 *
 * 设计要点（对齐 SDK 契约）：
 * - 未配置云服务时一律返回明确错误，绝不创建假账号 / 假会话 / localStorage 用户。
 * - OTP 的 challenge 保存在 service 实例（组件外），发码与验码是两个独立动作。
 * - 回调分发在启动时、任何登录守卫之前执行；成功只认真实 session。
 */
import { getCloudRuntime, isCloudEnabled, type CloudRuntime } from './client';
import { CLOUD_NOT_CONFIGURED_MESSAGE } from './public-config';
import type {
  CloudAuthPort,
  CloudIdentity,
  CloudSessionLike,
  OtpChannel,
  OtpPendingChallenge,
} from './ports';

export type AccountStatus = 'unconfigured' | 'guest' | 'signed-in';

export interface AccountSnapshot {
  status: AccountStatus;
  identity: CloudIdentity | null;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface CallbackResult {
  handled: boolean;
  message: string;
  cleanHref?: string;
}

const PHONE_PATTERN = /^1\d{10}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRecipient(channel: OtpChannel, value: string): string | null {
  const trimmed = value.trim();
  if (channel === 'phone') {
    return PHONE_PATTERN.test(trimmed) ? null : '请输入正确的 11 位手机号';
  }
  return EMAIL_PATTERN.test(trimmed) ? null : '请输入正确的邮箱地址';
}

function maskLabel(value: string, channel: OtpChannel): string {
  if (channel === 'phone') {
    return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
  }
  const [name, domain] = value.split('@');
  const head = name.length > 2 ? `${name.slice(0, 2)}***` : `${name.slice(0, 1)}***`;
  return `${head}@${domain}`;
}

export function toIdentity(session: {
  user: { id: string; email?: string; phone?: string; name?: string };
}): CloudIdentity {
  const user = session.user;
  const label =
    user.name?.trim() ||
    (user.email ? maskLabel(user.email, 'email') : undefined) ||
    (user.phone ? maskLabel(user.phone, 'phone') : undefined) ||
    '已登录用户';
  return { userId: user.id, label };
}

export interface AccountService {
  snapshot(): AccountSnapshot;
  subscribe(listener: (next: AccountSnapshot) => void): () => void;
  restoreSession(): Promise<AccountSnapshot>;
  handleCallback(href: string): Promise<CallbackResult>;
  sendCode(channel: OtpChannel, value: string): Promise<ActionResult>;
  verifyCode(channel: OtpChannel, value: string, token: string): Promise<ActionResult>;
  startWechatLogin(redirectTo: string): Promise<{ url: string | null; message: string }>;
  startWorkBuddyLogin(redirectTo: string): Promise<{ url: string | null; message: string }>;
  signOut(): Promise<ActionResult>;
}

export function createAccountService(
  runtime: CloudRuntime | null = getCloudRuntime(),
): AccountService {
  let current: AccountSnapshot = {
    status: isCloudEnabled() ? 'guest' : 'unconfigured',
    identity: null,
  };
  let pending: OtpPendingChallenge | null = null;
  const listeners = new Set<(next: AccountSnapshot) => void>();

  const emit = (next: AccountSnapshot): AccountSnapshot => {
    current = next;
    for (const listener of listeners) listener(next);
    return next;
  };

  // SDK 会回放 INITIAL_SESSION / TOKEN_REFRESHED / SIGNED_OUT 等事件（含其他标签页）。
  // 只有状态或账号真的变了才广播，避免 token 刷新噪声触发界面重载。
  let sdkUnsubscribe: (() => void) | null = null;
  const syncFromAuthEvent = (session: CloudSessionLike | null): void => {
    const next: AccountSnapshot = session
      ? { status: 'signed-in', identity: toIdentity(session) }
      : { status: isCloudEnabled() ? 'guest' : 'unconfigured', identity: null };
    if (current.status === next.status && current.identity?.userId === next.identity?.userId) {
      return;
    }
    emit(next);
  };

  const refreshSession = async (): Promise<AccountSnapshot> => {
    const auth: CloudAuthPort | null = runtime?.auth ?? null;
    if (!auth) return emit({ status: 'unconfigured', identity: null });
    const { data: session, error } = await auth.getSession();
    if (error || !session) return emit({ status: 'guest', identity: null });
    return emit({ status: 'signed-in', identity: toIdentity(session) });
  };

  const startOAuth = async (
    provider: 'wechat' | 'workbuddy',
    redirectTo: string,
  ): Promise<{ url: string | null; message: string }> => {
    const auth = runtime?.auth ?? null;
    if (!auth) return { url: null, message: CLOUD_NOT_CONFIGURED_MESSAGE };
    const { data, error } = await auth.signInWithOAuth({ provider, redirectTo });
    if (error || !data?.url) {
      const fallback =
        provider === 'wechat'
          ? '微信登录暂不可用，请改用验证码登录。'
          : 'WorkBuddy 账号登录暂不可用，请改用验证码登录。';
      return { url: null, message: error?.message || fallback };
    }
    return { url: data.url, message: '' };
  };

  return {
    snapshot: () => current,

    subscribe(listener) {
      listeners.add(listener);
      const auth = runtime?.auth ?? null;
      if (!sdkUnsubscribe && auth?.onAuthStateChange) {
        sdkUnsubscribe = auth.onAuthStateChange((_event, session) => syncFromAuthEvent(session));
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && sdkUnsubscribe) {
          sdkUnsubscribe();
          sdkUnsubscribe = null;
        }
      };
    },

    restoreSession: refreshSession,

    async handleCallback(href) {
      const url = new URL(href);
      const hasCode = url.searchParams.has('code');
      const hasError = url.searchParams.has('error');
      if (!hasCode && !hasError) {
        await refreshSession();
        return { handled: false, message: '' };
      }

      // 授权被拒绝：Relay 可能只带回 error 而无 code，仍要作为回调处理并清理 URL。
      if (!hasCode) {
        const reason =
          url.searchParams.get('error_description') ||
          url.searchParams.get('error') ||
          '授权未完成';
        for (const key of ['code', 'state', 'provider', 'error', 'error_description']) {
          url.searchParams.delete(key);
        }
        await refreshSession();
        return {
          handled: true,
          message: `登录未完成：${reason}。请重试。`,
          cleanHref: `${url.pathname}${url.search}${url.hash}`,
        };
      }

      const provider = url.searchParams.get('provider');
      const knownProvider = provider === 'workbuddy' || provider === 'wechat' ? provider : null;
      if (provider && !knownProvider) {
        return { handled: true, message: '授权回调缺少有效的登录方式，请重新登录。' };
      }

      const auth = runtime?.auth ?? null;
      if (!auth) return { handled: true, message: CLOUD_NOT_CONFIGURED_MESSAGE };

      // Relay 回调可能不带 provider：SDK 的 workbuddy handler 对非自身回调返回
      // { data: null, error: null }，因此按 workbuddy → wechat 依次尝试；
      // 只有拿到真实 session 才算登录成功，绝不伪造。
      const order: Array<'workbuddy' | 'wechat'> = knownProvider
        ? [knownProvider]
        : ['workbuddy', 'wechat'];
      let firstError: { message: string } | null = null;
      let missingHandler = false;
      for (const name of order) {
        const handler =
          name === 'workbuddy' ? auth.handleWorkBuddyCallback : auth.handleWechatWebCallback;
        if (typeof handler !== 'function') {
          missingHandler = true;
          continue;
        }
        const { data: session, error } = await handler.call(auth, url.search);
        if (error && !firstError) firstError = error;
        if (!session) continue;

        for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key);
        emit({ status: 'signed-in', identity: toIdentity(session) });
        return {
          handled: true,
          message: '',
          cleanHref: `${url.pathname}${url.search}${url.hash}`,
        };
      }

      if (firstError) return { handled: true, message: firstError.message || '登录失败，请重试。' };
      if (missingHandler) {
        return { handled: true, message: '暂时无法使用此方式登录，请联系应用管理员。' };
      }
      await refreshSession();
      return { handled: false, message: '' };
    },

    async sendCode(channel, value) {
      const trimmed = value.trim();
      const invalid = validateRecipient(channel, trimmed);
      if (invalid) return { ok: false, message: invalid };
      const auth = runtime?.auth ?? null;
      if (!auth) return { ok: false, message: CLOUD_NOT_CONFIGURED_MESSAGE };

      const credentials = channel === 'phone' ? { phone: trimmed } : { email: trimmed };
      const { data, error } = await auth.sendOtp(credentials);
      if (error || !data) {
        return { ok: false, message: error?.message || '验证码发送失败，请稍后再试。' };
      }
      // 只有一次成功的发码才能替换 challenge；验码失败不清空，便于重试。
      pending = {
        channel,
        value: trimmed,
        verificationId: data.verificationId,
        isExistingUser: data.isExistingUser,
      };
      return { ok: true, message: '验证码已发送，请在有效期内输入。' };
    },

    async verifyCode(channel, value, token) {
      const trimmed = value.trim();
      const auth = runtime?.auth ?? null;
      if (!auth) return { ok: false, message: CLOUD_NOT_CONFIGURED_MESSAGE };
      if (!pending || pending.channel !== channel || pending.value !== trimmed) {
        return { ok: false, message: '请先为当前账号获取验证码。' };
      }
      if (!token.trim()) return { ok: false, message: '请输入验证码。' };

      const { data: session, error } = await auth.verifyOtp({
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: token.trim(),
        ...(channel === 'phone' ? { phone: pending.value } : { email: pending.value }),
      });
      if (error || !session) {
        return { ok: false, message: error?.message || '验证码不正确，请重试。' };
      }
      pending = null;
      emit({ status: 'signed-in', identity: toIdentity(session) });
      return { ok: true, message: '登录成功。' };
    },

    startWechatLogin: (redirectTo) => startOAuth('wechat', redirectTo),
    startWorkBuddyLogin: (redirectTo) => startOAuth('workbuddy', redirectTo),

    async signOut() {
      const auth = runtime?.auth ?? null;
      if (!auth) return { ok: false, message: CLOUD_NOT_CONFIGURED_MESSAGE };
      const { error } = await auth.signOut();
      pending = null;
      // 登出无论服务端返回什么都清本地（SDK 自身也如此），避免残留已失效的界面登录态。
      emit({ status: 'guest', identity: null });
      return error
        ? { ok: true, message: `已退出登录（${error.message}）。` }
        : { ok: true, message: '已退出登录。' };
    },
  };
}
