import { useCallback, useEffect, useRef, useState } from 'react';
import App from '../App';
import { WorkspaceIcon } from '../WorkspaceIcon';
import { createAccountService } from './account';
import LoginModal from './LoginModal';
import { createWorkspaceStorage, storageScopeFor } from './workspace-storage';
import './login.css';

export default function AccountWorkspace() {
  const [service] = useState(() => createAccountService());
  const [account, setAccount] = useState(() => service.snapshot());
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const reloadPending = useRef(false);

  const reloadWorkspace = useCallback(() => {
    if (reloadPending.current) return;
    reloadPending.current = true;
    window.location.reload();
  }, []);

  useEffect(() => {
    let lastStatus = service.snapshot().status;
    return service.subscribe((next) => {
      setAccount(next);
      if (lastStatus === 'signed-in' && next.status !== 'signed-in') reloadWorkspace();
      lastStatus = next.status;
    });
  }, [service, reloadWorkspace]);

  const initializeWorkspace = useCallback(async () => {
    const callback = await service.handleCallback(window.location.href);
    if (callback.cleanHref) window.history.replaceState(null, '', callback.cleanHref);
    if (callback.message) setNotice(callback.message);
    const snapshot = callback.handled ? service.snapshot() : await service.restoreSession();
    setAccount(snapshot);
    const scope = storageScopeFor(snapshot);
    return { scope, storage: await createWorkspaceStorage(scope) };
  }, [service]);

  const label = account.identity?.label;
  return (
    <App
      initializeWorkspace={initializeWorkspace}
      accountNotice={notice}
      accountControl={
        <button
          type="button"
          className={`wst-account-btn${label ? ' is-signed-in' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label ? '账号与项目空间' : undefined}
          title={label}
          onClick={() => setOpen(true)}
        >
          <WorkspaceIcon name="user" size={17} />
          <span>{label ?? '登录'}</span>
        </button>
      }
      accountDialog={
        <LoginModal
          open={open}
          onClose={() => setOpen(false)}
          service={service}
          snapshot={account}
          scope={storageScopeFor(account)}
          onAccountChanged={reloadWorkspace}
        />
      }
    />
  );
}
