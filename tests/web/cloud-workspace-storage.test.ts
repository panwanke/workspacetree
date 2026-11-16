import { describe, expect, it, afterEach } from 'vitest';
import { setCloudRuntimeForTests, isCloudEnabled } from '../../apps/web/src/cloud/client';
import { storageScopeFor } from '../../apps/web/src/cloud/workspace-storage';
import { oauthRedirectTo } from '../../apps/web/src/cloud/LoginModal';
import {
  scopedSessionKey,
  WORKSPACE_SESSION_STORAGE_KEY,
} from '../../apps/web/src/workspace-session';

const emptyTable = {
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

describe('storage scope selection', () => {
  afterEach(() => setCloudRuntimeForTests(null));

  it('stays local when cloud is unconfigured, even with a signed-in-looking snapshot', () => {
    setCloudRuntimeForTests(null);
    expect(isCloudEnabled()).toBe(false);
    expect(storageScopeFor({ status: 'signed-in', identity: { userId: 'u', label: 'u' } })).toBe(
      'local',
    );
    expect(storageScopeFor({ status: 'unconfigured', identity: null })).toBe('local');
  });

  it('switches to account only when both conditions hold', () => {
    setCloudRuntimeForTests({
      auth: {
        async getSession() {
          return { data: null, error: null };
        },
        async sendOtp() {
          return { data: null, error: { message: '' } };
        },
        async verifyOtp() {
          return { data: null, error: { message: '' } };
        },
        async signInWithOAuth() {
          return { data: null, error: { message: '' } };
        },
        async signOut() {
          return { data: null, error: null };
        },
        onAuthStateChange() {
          return () => undefined;
        },
      },
      projects: emptyTable,
    });
    expect(isCloudEnabled()).toBe(true);
    expect(storageScopeFor({ status: 'guest', identity: null })).toBe('local');
    expect(storageScopeFor({ status: 'signed-in', identity: { userId: 'u', label: 'u' } })).toBe(
      'account',
    );
  });

  it('uses separate tab-session keys for local and account spaces', () => {
    expect(scopedSessionKey('local')).toBe(WORKSPACE_SESSION_STORAGE_KEY);
    expect(scopedSessionKey('account')).not.toBe(WORKSPACE_SESSION_STORAGE_KEY);
  });
});

describe('oauthRedirectTo', () => {
  it('always targets the app root, never an /auth/callback sub-path', () => {
    expect(oauthRedirectTo('https://app.example.com/workspacetree/?a=1', '/workspacetree/')).toBe(
      'https://app.example.com/workspacetree/?a=1',
    );
  });

  it('strips spent callback parameters but keeps business params and hash', () => {
    expect(
      oauthRedirectTo(
        'https://app.example.com/?code=abc&state=s&provider=wechat&sharecode=keep#p2',
        '/',
      ),
    ).toBe('https://app.example.com/?sharecode=keep#p2');
  });
});
