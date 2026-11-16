import { useEffect, useRef, useState } from 'react';
import { WorkspaceIcon } from '../WorkspaceIcon';
import logo from '../assets/logo.svg';
import type { StorageScope } from '../workspace-session';
import { validateRecipient, type AccountService, type AccountSnapshot } from './account';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  service: AccountService;
  snapshot: AccountSnapshot;
  scope: StorageScope;
  onAccountChanged: () => void;
}

type PendingAction = 'send' | 'verify' | 'wechat' | 'workbuddy' | 'sign-out';

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [token, setToken] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      phoneRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const busy = pending !== null;
  const unconfigured = snapshot.status === 'unconfigured';
  const signedIn = snapshot.status === 'signed-in';

  async function runAction(action: PendingAction, run: () => Promise<void>) {
    setPending(action);
    setNotice('');
    setError('');
    try {
      await run();
    } catch {
      setError('操作失败，请检查网络连接后重试。');
    } finally {
      setPending(null);
    }
  }

  function handleSendCode() {
    const validation = validateRecipient('phone', phone);
    setPhoneError(validation ?? '');
    if (validation) {
      phoneRef.current?.focus();
      return;
    }
    return runAction('send', async () => {
      const result = await service.sendCode('phone', phone);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCodeSent(true);
      setNotice(result.message);
      codeRef.current?.focus();
    });
  }

  function handleVerify() {
    return runAction('verify', async () => {
      const result = await service.verifyCode('phone', phone, token);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onAccountChanged();
    });
  }

  function handleOAuthLogin(provider: 'wechat' | 'workbuddy') {
    return runAction(provider, async () => {
      const redirectTo = oauthRedirectTo(window.location.href, import.meta.env.BASE_URL || '/');
      const result =
        provider === 'wechat'
          ? await service.startWechatLogin(redirectTo)
          : await service.startWorkBuddyLogin(redirectTo);
      if (!result.url) {
        setError(result.message);
        return;
      }
      window.location.assign(result.url);
    });
  }

  function handleSignOut() {
    return runAction('sign-out', async () => {
      const result = await service.signOut();
      if (result.ok) onAccountChanged();
      else setError(result.message);
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="wst-login-modal"
      aria-labelledby="login-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wst-login-layout">
        <div className="wst-login-brand">
          <div className="wst-login-wordmark">
            <img src={logo} alt="" width={30} height={30} />
            <span>WorkspaceTree</span>
          </div>
          <div className="wst-login-graph" aria-hidden="true">
            <span className="wst-login-graph-root" />
            <span className="wst-login-graph-link" />
            <span className="wst-login-graph-leaf" />
            <span className="wst-login-graph-leaf" />
          </div>
          <p>
            {signedIn
              ? '可在其他设备继续编辑云端项目。'
              : '登录账号后，可在其他设备继续编辑云端项目。'}
          </p>
        </div>

        <div className="wst-login-content">
          <button
            type="button"
            className="wst-login-close"
            aria-label="关闭账号面板"
            onClick={onClose}
          >
            <WorkspaceIcon name="close" size={18} />
          </button>
          <h2 id="login-modal-title">{signedIn ? '账号与项目空间' : '登录 WorkspaceTree'}</h2>

          {unconfigured ? (
            <p className="wst-login-description">当前部署尚未启用账号服务。项目保存在此浏览器。</p>
          ) : signedIn ? (
            <>
              <dl className="wst-login-account-details">
                <div>
                  <dt>当前账号</dt>
                  <dd>{snapshot.identity?.label}</dd>
                </div>
                <div>
                  <dt>项目空间</dt>
                  <dd>{scope === 'account' ? '账号云端' : '浏览器本地'}</dd>
                </div>
              </dl>
              {error && (
                <p className="wst-login-error" role="alert">
                  {error}
                </p>
              )}
              <button
                type="button"
                className="wst-login-secondary"
                disabled={busy}
                onClick={() => void handleSignOut()}
              >
                {pending === 'sign-out' ? '正在退出…' : '退出登录'}
              </button>
            </>
          ) : (
            <>
              <p className="wst-login-description">使用手机号登录或注册。</p>
              <form
                className="wst-login-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy) return;
                  if (!codeSent) void handleSendCode();
                  else if (token.trim()) void handleVerify();
                }}
              >
                <label className="wst-login-field">
                  手机号
                  <input
                    ref={phoneRef}
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="11 位手机号"
                    aria-invalid={Boolean(phoneError)}
                    aria-describedby={phoneError ? 'wst-phone-error' : undefined}
                    value={phone}
                    readOnly={busy}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      setPhoneError('');
                      setToken('');
                      setCodeSent(false);
                      setNotice('');
                      setError('');
                    }}
                  />
                </label>
                {phoneError && (
                  <p id="wst-phone-error" className="wst-login-error" role="alert">
                    {phoneError}
                  </p>
                )}
                <div className="wst-login-code-row">
                  <label className="wst-login-field">
                    验证码
                    <input
                      ref={codeRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="输入短信验证码"
                      value={token}
                      readOnly={busy}
                      onChange={(event) => setToken(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="wst-login-secondary"
                    disabled={busy}
                    onClick={() => void handleSendCode()}
                  >
                    {pending === 'send' ? '发送中…' : codeSent ? '重新获取' : '获取验证码'}
                  </button>
                </div>
                {notice && (
                  <p className="wst-login-notice" role="status">
                    {notice}
                  </p>
                )}
                <button
                  type="submit"
                  className="wst-login-primary"
                  disabled={busy || !codeSent || !token.trim()}
                >
                  {pending === 'verify' ? '登录中…' : '登录 / 注册'}
                  <WorkspaceIcon name="arrow" size={16} />
                </button>
              </form>

              <div className="wst-login-divider">其他登录方式</div>
              <div className="wst-login-providers">
                <button
                  type="button"
                  className="wst-login-secondary"
                  disabled={busy}
                  aria-label={pending === 'workbuddy' ? undefined : 'WorkBuddy 账号登录'}
                  onClick={() => void handleOAuthLogin('workbuddy')}
                >
                  <WorkspaceIcon name="user" size={16} />
                  {pending === 'workbuddy' ? '正在跳转…' : 'WorkBuddy'}
                </button>
                <button
                  type="button"
                  className="wst-login-secondary"
                  disabled={busy}
                  onClick={() => void handleOAuthLogin('wechat')}
                >
                  <WorkspaceIcon name="message" size={16} />
                  {pending === 'wechat' ? '正在跳转…' : '微信扫码登录'}
                </button>
              </div>
              {error && (
                <p className="wst-login-error wst-login-action-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}

          {!signedIn && (
            <div className="wst-login-footer">
              <button type="button" className="wst-login-local" onClick={onClose}>
                继续使用本地空间 <WorkspaceIcon name="arrow" size={14} />
              </button>
              {!unconfigured && <p>本地项目可以通过导出和导入手动迁移。</p>}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
