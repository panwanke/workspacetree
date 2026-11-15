import { useEffect, useState } from 'react';
import { WorkspaceIcon } from './WorkspaceIcon';
import { CLOUD_NOT_CONFIGURED_MESSAGE } from './cloud/public-config';
import type { AccountService, AccountSnapshot } from './cloud/account';
import type { StorageScope } from './workspace-storage';

export interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  service: AccountService;
  snapshot: AccountSnapshot;
  scope: StorageScope;
  /** 登录态变化后重新初始化工作区（控制器持有 storage 引用，刷新最稳妥）。 */
  onAccountChanged: (message: string) => void;
}

/** OAuth 回调必须落到应用根，不能是 /auth/callback 之类子路径（静态托管会 404）。 */
export function oauthRedirectTo(href: string, basePath: string): string {
  const back = new URL(href);
  back.pathname = basePath.endsWith('/') ? basePath : `${basePath}/`;
  for (const key of ['code', 'state', 'provider', 'error', 'error_description']) {
    back.searchParams.delete(key);
  }
  return back.toString();
}

export default function LoginModal({
  open,
  onClose,
  service,
  snapshot,
  scope,
  onAccountChanged,
}: LoginModalProps) {
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [token, setToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oauthStarting, setOauthStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const unconfigured = snapshot.status === 'unconfigured';
  const signedIn = snapshot.status === 'signed-in';

  async function handleSendCode() {
    setError('');
    setNotice('');
    // 先在本层给出即时字段校验，service 内部仍会再校验一次。
    if (!/^1\d{10}$/.test(phone.trim())) {
      setPhoneError('请输入正确的 11 位手机号');
      return;
    }
    setPhoneError('');
    setSending(true);
    try {
      const result = await service.sendCode('phone', phone);
      if (result.ok) {
        setCodeSent(true);
        setNotice('验证码已发送，请在有效期内输入。');
      } else {
        setError(result.message);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const result = await service.verifyCode('phone', phone, token);
      if (!result.ok) {
        // 验码失败保留 challenge，用户可直接重试，不重新发码。
        setError(result.message);
        return;
      }
      setToken('');
      setCodeSent(false);
      onAccountChanged(result.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuthLogin(provider: 'wechat' | 'workbuddy') {
    setError('');
    setNotice('');
    setOauthStarting(true);
    try {
      const redirectTo = oauthRedirectTo(window.location.href, import.meta.env.BASE_URL || '/');
      const result =
        provider === 'wechat'
          ? await service.startWechatLogin(redirectTo)
          : await service.startWorkBuddyLogin(redirectTo);
      if (!result.url) {
        setError(result.message);
        return;
      }
      // 同标签页跳转：PKCE verifier 存在当前标签页的 sessionStorage。
      window.location.assign(result.url);
    } finally {
      setOauthStarting(false);
    }
  }

  async function handleSignOut() {
    setError('');
    setNotice('');
    const result = await service.signOut();
    onAccountChanged(result.message);
  }

  return (
    <div
      className="wst-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wst-settings-modal wst-login-modal">
        <div className="wst-modal-header">
          <h2 id="login-modal-title">
            <WorkspaceIcon name="panel" size={18} /> 账号与项目空间
          </h2>
          <button
            type="button"
            className="wst-tool is-icon"
            aria-label="关闭账号面板"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" size={16} />
          </button>
        </div>

        <div className="wst-modal-body">
          <p className="wst-settings-desc">
            登录后新建和编辑的项目会保存到当前账号，可跨设备继续；未登录时项目只保存在这台浏览器。
            本地已有项目不会自动迁移，可用「另存为 / 导入」手动搬运。
          </p>

          {unconfigured && <div className="wst-modal-error">{CLOUD_NOT_CONFIGURED_MESSAGE}</div>}
          {notice && <div className="wst-login-notice">{notice}</div>}
          {error && <div className="wst-modal-error">{error}</div>}

          {signedIn ? (
            <div className="wst-login-section">
              <div className="wst-login-row">
                <span className="wst-login-label">当前账号</span>
                <span className="wst-login-value">{snapshot.identity?.label}</span>
              </div>
              <div className="wst-login-row">
                <span className="wst-login-label">项目空间</span>
                <span className="wst-login-value">
                  {scope === 'account' ? '账号云端（按账号隔离）' : '浏览器本地'}
                </span>
              </div>
              <button
                type="button"
                className="wst-tool is-danger"
                onClick={() => void handleSignOut()}
              >
                退出登录
              </button>
            </div>
          ) : (
            <div className="wst-login-section">
              <div className="wst-login-title">手机号验证码登录 / 注册</div>
              <label className="wst-login-field">
                <span>手机号</span>
                <input
                  className="wst-project-rename-input"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="11 位手机号"
                  value={phone}
                  disabled={unconfigured || sending}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setPhoneError('');
                    if (codeSent) setCodeSent(false);
                  }}
                />
              </label>
              {phoneError && <div className="wst-login-field-error">{phoneError}</div>}
              <div className="wst-login-code-row">
                <label className="wst-login-field is-grow">
                  <span>验证码</span>
                  <input
                    className="wst-project-rename-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="请输入验证码"
                    value={token}
                    disabled={unconfigured || submitting}
                    onChange={(event) => setToken(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="wst-tool"
                  disabled={unconfigured || sending}
                  onClick={() => void handleSendCode()}
                >
                  {sending ? '发送中…' : codeSent ? '重新获取' : '获取验证码'}
                </button>
              </div>
              <button
                type="button"
                className="wst-tool is-primary wst-login-submit"
                disabled={unconfigured || submitting || !token.trim()}
                onClick={() => void handleVerify()}
              >
                {submitting ? '登录中…' : '登录 / 注册'}
              </button>

              <div className="wst-login-divider">或</div>
              <button
                type="button"
                className="wst-tool wst-login-submit"
                disabled={unconfigured || oauthStarting}
                onClick={() => void handleOAuthLogin('workbuddy')}
              >
                {oauthStarting ? '正在跳转…' : 'WorkBuddy 账号登录'}
              </button>
              <button
                type="button"
                className="wst-tool wst-login-submit"
                disabled={unconfigured || oauthStarting}
                onClick={() => void handleOAuthLogin('wechat')}
              >
                {oauthStarting ? '正在跳转…' : '微信扫码登录'}
              </button>
              <p className="wst-login-hint">
                微信扫码登录需在管理面板开启；两种跳转都必须在应用已发布的 HTTPS
                域名下进行，回调落在站点根路径，且不能新开标签页（PKCE 证明只在当前标签页）。
              </p>
            </div>
          )}
        </div>

        <div className="wst-modal-footer">
          <span className="wst-projects-count">
            {unconfigured ? '云服务未配置' : signedIn ? '已登录' : '未登录 · 本地游客模式'}
          </span>
          <button type="button" className="wst-tool is-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
