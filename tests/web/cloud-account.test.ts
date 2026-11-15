import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createAccountService,
  validateRecipient,
  toIdentity,
} from '../../apps/web/src/cloud/account';
import { setCloudRuntimeForTests, isCloudEnabled } from '../../apps/web/src/cloud/client';
import { CLOUD_NOT_CONFIGURED_MESSAGE } from '../../apps/web/src/cloud/public-config';
import type {
  CloudAuthPort,
  CloudProjectTablePort,
  CloudResultLike,
  CloudSessionLike,
  OtpChallengeLike,
} from '../../apps/web/src/cloud/ports';
import type { CloudRuntime } from '../../apps/web/src/cloud/client';

interface FakeAuthState {
  session: CloudSessionLike | null;
  sendCalls: Array<{ email?: string; phone?: string }>;
  verifyCalls: Array<Record<string, unknown>>;
  sendResult: CloudResultLike<OtpChallengeLike>;
  verifyResult: CloudResultLike<CloudSessionLike>;
  oauthResult: CloudResultLike<{ url: string }>;
  oauthCalls: Array<{ provider: string; redirectTo: string }>;
  callbackSessions: Record<'wechat' | 'workbuddy', CloudSessionLike | null>;
  callbackErrors: Partial<Record<'wechat' | 'workbuddy', { message: string }>>;
  callbackCalls: string[];
  signOutCalls: number;
  signOutError: { message: string } | null;
  authStateCallbacks: Array<(event: string, session: CloudSessionLike | null) => void>;
}

function fakeAuth(state: FakeAuthState): CloudAuthPort {
  return {
    async getSession() {
      return { data: state.session, error: null };
    },
    async sendOtp(credentials) {
      state.sendCalls.push(credentials);
      return state.sendResult;
    },
    async verifyOtp(params) {
      state.verifyCalls.push(params as unknown as Record<string, unknown>);
      return state.verifyResult;
    },
    async signInWithOAuth(options) {
      state.oauthCalls.push({ provider: options.provider, redirectTo: options.redirectTo });
      return state.oauthResult;
    },
    async handleWechatWebCallback(search) {
      state.callbackCalls.push(`wechat:${search ?? ''}`);
      const error = state.callbackErrors.wechat;
      return error ? { data: null, error } : { data: state.callbackSessions.wechat, error: null };
    },
    async handleWorkBuddyCallback(search) {
      state.callbackCalls.push(`workbuddy:${search ?? ''}`);
      const error = state.callbackErrors.workbuddy;
      return error
        ? { data: null, error }
        : { data: state.callbackSessions.workbuddy, error: null };
    },
    async signOut() {
      state.signOutCalls += 1;
      state.session = null;
      return { data: null, error: state.signOutError };
    },
    onAuthStateChange(callback) {
      state.authStateCallbacks.push(callback);
      return () => {
        state.authStateCallbacks = state.authStateCallbacks.filter((fn) => fn !== callback);
      };
    },
  };
}

function noTable(): CloudProjectTablePort {
  return {
    async list() {
      return { data: [], error: null };
    },
    async get() {
      return { data: null, error: null };
    },
    async upsert() {
      return { data: { affected: 1 }, error: null };
    },
    async remove() {
      return { data: { affected: 1 }, error: null };
    },
  };
}

const signedInSession: CloudSessionLike = {
  user: { id: 'uid_1', name: '晚坷' },
};

function makeState(): FakeAuthState {
  return {
    session: null,
    sendCalls: [],
    verifyCalls: [],
    sendResult: { data: { verificationId: 'vid_1', isExistingUser: false }, error: null },
    verifyResult: { data: signedInSession, error: null },
    oauthResult: { data: { url: 'https://relay.example/authorize' }, error: null },
    oauthCalls: [],
    callbackSessions: { wechat: null, workbuddy: null },
    callbackErrors: {},
    callbackCalls: [],
    signOutCalls: 0,
    signOutError: null,
    authStateCallbacks: [],
  };
}

function runtimeFor(state: FakeAuthState): CloudRuntime {
  return { auth: fakeAuth(state), projects: noTable() };
}

describe('validateRecipient', () => {
  it('accepts exactly 11 mainland digits starting with 1', () => {
    expect(validateRecipient('phone', '13800138000')).toBeNull();
    expect(validateRecipient('phone', '1380013800')).toBe('请输入正确的 11 位手机号');
    expect(validateRecipient('phone', '23800138000')).toBe('请输入正确的 11 位手机号');
    expect(validateRecipient('phone', '1380013800a')).toBe('请输入正确的 11 位手机号');
  });

  it('validates email shape', () => {
    expect(validateRecipient('email', 'a@b.com')).toBeNull();
    expect(validateRecipient('email', 'broken')).toBe('请输入正确的邮箱地址');
  });
});

describe('toIdentity', () => {
  it('uses name first and falls back to masked contact, never raw phone/email', () => {
    expect(toIdentity({ user: { id: 'u', name: '晚坷', email: 'wanke@example.com' } }).label).toBe(
      '晚坷',
    );
    expect(toIdentity({ user: { id: 'u', email: 'wanke@example.com' } }).label).toBe(
      'wa***@example.com',
    );
    expect(toIdentity({ user: { id: 'u', phone: '13800138000' } }).label).toBe('138****8000');
    expect(toIdentity({ user: { id: 'u' } }).label).toBe('已登录用户');
  });
});

describe('account service (configured)', () => {
  let state: FakeAuthState;

  beforeEach(() => {
    state = makeState();
    setCloudRuntimeForTests(runtimeFor(state));
  });

  afterEach(() => {
    setCloudRuntimeForTests(null);
    vi.restoreAllMocks();
  });

  it('reports enabled and starts as guest', () => {
    expect(isCloudEnabled()).toBe(true);
    const service = createAccountService();
    expect(service.snapshot()).toEqual({ status: 'guest', identity: null });
  });

  it('restores a real session only, and notifies subscribers', async () => {
    const service = createAccountService();
    const seen: string[] = [];
    service.subscribe((next) => seen.push(next.status));
    state.session = signedInSession;
    const snapshot = await service.restoreSession();
    expect(snapshot).toEqual({ status: 'signed-in', identity: { userId: 'uid_1', label: '晚坷' } });
    expect(seen).toEqual(['signed-in']);
  });

  it('syncs an external sign-out from another tab but ignores token-refresh noise', async () => {
    const service = createAccountService();
    state.session = signedInSession;
    await service.restoreSession();
    const seen: string[] = [];
    service.subscribe((next) => seen.push(next.status));
    expect(state.authStateCallbacks).toHaveLength(1);

    state.authStateCallbacks.forEach((callback) => callback('TOKEN_REFRESHED', signedInSession));
    expect(seen).toEqual([]);

    state.authStateCallbacks.forEach((callback) => callback('SIGNED_OUT', null));
    expect(seen).toEqual(['guest']);
    expect(service.snapshot().status).toBe('guest');
  });

  it('unsubscribes the SDK auth listener when the last listener leaves', () => {
    const service = createAccountService();
    const off = service.subscribe(() => undefined);
    expect(state.authStateCallbacks).toHaveLength(1);
    off();
    expect(state.authStateCallbacks).toHaveLength(0);
  });

  it('send once then verify: no new code on submit, and a wrong code keeps the challenge', async () => {
    const service = createAccountService();
    expect((await service.sendCode('phone', '13800138000')).ok).toBe(true);
    expect(state.sendCalls).toHaveLength(1);

    state.verifyResult = { data: null, error: { message: '验证码错误' } };
    const failed = await service.verifyCode('phone', '13800138000', '000000');
    expect(failed.ok).toBe(false);
    expect(state.sendCalls).toHaveLength(1);

    state.verifyResult = { data: signedInSession, error: null };
    expect((await service.verifyCode('phone', '13800138000', '123456')).ok).toBe(true);
    expect(state.sendCalls).toHaveLength(1);
    expect(state.verifyCalls).toHaveLength(2);
    expect(state.verifyCalls[1]).toMatchObject({
      verificationId: 'vid_1',
      isExistingUser: false,
      phone: '13800138000',
      token: '123456',
    });
    expect(service.snapshot().status).toBe('signed-in');
  });

  it('does not send a request for an invalid phone number', async () => {
    const service = createAccountService();
    const result = await service.sendCode('phone', '12345');
    expect(result.ok).toBe(false);
    expect(state.sendCalls).toHaveLength(0);
  });

  it('requires a fresh code when the recipient changes', async () => {
    const service = createAccountService();
    await service.sendCode('phone', '13800138000');
    const result = await service.verifyCode('phone', '13900139000', '123456');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('请先为当前账号获取验证码');
    expect(state.verifyCalls).toHaveLength(0);
  });

  it('surfaces a send failure and does not create a challenge', async () => {
    state.sendResult = { data: null, error: { message: '发送失败', kind: 'rate-limited' } };
    const service = createAccountService();
    expect((await service.sendCode('phone', '13800138000')).ok).toBe(false);
    expect((await service.verifyCode('phone', '13800138000', '123456')).ok).toBe(false);
    expect(state.verifyCalls).toHaveLength(0);
  });

  it('clears local state on sign out even when the server reports an error', async () => {
    const service = createAccountService();
    state.session = signedInSession;
    state.signOutError = { message: '服务端已断开' };
    await service.restoreSession();
    const result = await service.signOut();
    expect(result.ok).toBe(true);
    expect(result.message).toContain('服务端已断开');
    expect(service.snapshot()).toEqual({ status: 'guest', identity: null });
    expect(state.signOutCalls).toBe(1);
  });

  it('starts WeChat OAuth with the given redirect target only after a user action', async () => {
    const service = createAccountService();
    const result = await service.startWechatLogin('https://app.example.com/');
    expect(result.url).toBe('https://relay.example/authorize');
    expect(state.oauthCalls).toEqual([
      { provider: 'wechat', redirectTo: 'https://app.example.com/' },
    ]);
    expect(state.callbackCalls).toHaveLength(0);
  });

  it('starts WorkBuddy account OAuth with an absolute root redirect', async () => {
    const service = createAccountService();
    const result = await service.startWorkBuddyLogin('https://app.example.com/');
    expect(result.url).toBe('https://relay.example/authorize');
    expect(state.oauthCalls).toEqual([
      { provider: 'workbuddy', redirectTo: 'https://app.example.com/' },
    ]);
  });
});

describe('account service callback dispatcher', () => {
  let state: FakeAuthState;

  beforeEach(() => {
    state = makeState();
    setCloudRuntimeForTests(runtimeFor(state));
  });

  afterEach(() => setCloudRuntimeForTests(null));

  it('ordinary startup restores session without invoking any OAuth handler', async () => {
    const service = createAccountService();
    const result = await service.handleCallback('https://app.example.com/?view=canvas');
    expect(result.handled).toBe(false);
    expect(state.callbackCalls).toHaveLength(0);
  });

  it('dispatches exactly one handler by provider and clears the spent code from the URL', async () => {
    state.callbackSessions.wechat = signedInSession;
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?code=abc&state=s1&provider=wechat&sharecode=keep',
    );
    expect(state.callbackCalls).toEqual([
      'wechat:?code=abc&state=s1&provider=wechat&sharecode=keep',
    ]);
    expect(result.cleanHref).toBe('/?sharecode=keep');
    expect(service.snapshot().status).toBe('signed-in');
  });

  it('uses the WorkBuddy handler for provider=workbuddy, preserving business query params', async () => {
    state.callbackSessions.workbuddy = signedInSession;
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?code=abc&state=s1&provider=workbuddy&from=slide#section',
    );
    expect(state.callbackCalls).toHaveLength(1);
    expect(state.callbackCalls[0].startsWith('workbuddy:')).toBe(true);
    expect(result.cleanHref).toBe('/?from=slide#section');
  });

  it('prefers the WorkBuddy handler when a provider-less callback is its own', async () => {
    state.callbackSessions.workbuddy = signedInSession;
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?code=abc&state=s1&sharecode=keep',
    );
    expect(state.callbackCalls).toHaveLength(1);
    expect(state.callbackCalls[0].startsWith('workbuddy:')).toBe(true);
    expect(result.cleanHref).toBe('/?sharecode=keep');
    expect(service.snapshot().status).toBe('signed-in');
  });

  it('falls back to WeChat when the relay omits provider and WorkBuddy cannot exchange', async () => {
    state.callbackSessions.wechat = signedInSession;
    state.callbackErrors.workbuddy = { message: 'no local PKCE verifier' };
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?code=abc&state=s1&sharecode=keep',
    );
    expect(state.callbackCalls).toHaveLength(2);
    expect(state.callbackCalls[0].startsWith('workbuddy:')).toBe(true);
    expect(state.callbackCalls[1].startsWith('wechat:')).toBe(true);
    expect(result.cleanHref).toBe('/?sharecode=keep');
    expect(service.snapshot().status).toBe('signed-in');
  });

  it('rejects an unknown provider without creating a session', async () => {
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?code=abc&provider=unknown',
    );
    expect(result.handled).toBe(true);
    expect(result.message).toContain('缺少有效的登录方式');
    expect(state.callbackCalls).toHaveLength(0);
    expect(service.snapshot().status).toBe('guest');
  });

  it('processes an error-only callback and clears its parameters', async () => {
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?error=access_denied&error_description=cancelled',
    );
    expect(result.handled).toBe(true);
    expect(result.message).toContain('cancelled');
    expect(result.cleanHref).toBe('/');
    expect(state.callbackCalls).toHaveLength(0);
  });

  it('keeps the user signed out when the exchange fails', async () => {
    state.callbackErrors.wechat = { message: 'invalid state' };
    const service = createAccountService();
    const result = await service.handleCallback(
      'https://app.example.com/?code=abc&state=s1&provider=wechat',
    );
    expect(result.handled).toBe(true);
    expect(result.message).toBe('invalid state');
    expect(result.cleanHref).toBeUndefined();
    expect(service.snapshot().status).toBe('guest');
  });
});

describe('account service (unconfigured)', () => {
  afterEach(() => setCloudRuntimeForTests(null));

  it('never fakes a login and always returns an explicit configuration message', async () => {
    setCloudRuntimeForTests(null);
    expect(isCloudEnabled()).toBe(false);
    const service = createAccountService();
    expect(service.snapshot().status).toBe('unconfigured');
    expect((await service.sendCode('phone', '13800138000')).message).toBe(
      CLOUD_NOT_CONFIGURED_MESSAGE,
    );
    expect((await service.verifyCode('phone', '13800138000', '123456')).message).toBe(
      CLOUD_NOT_CONFIGURED_MESSAGE,
    );
    expect((await service.startWechatLogin('https://app.example.com/')).url).toBeNull();
    expect((await service.restoreSession()).status).toBe('unconfigured');
  });
});
