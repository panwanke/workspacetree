import { describe, expect, it } from 'vitest';
import { describeAuthError } from '../../apps/web/src/cloud/auth-errors';

/**
 * 这些用例锁定「认证错误必须给中文可行动文案」这条约束。
 *
 * 回归背景：线上手机号验证码发送失败时，UI 曾直接显示腾讯云原文
 * `send error code FailedOperation.PhoneNumberInBlacklist msg number on the blacklist`，
 * 用户既读不懂也不知道下一步该怎么办。
 */
describe('describeAuthError', () => {
  it('falls back to the caller message when there is no error object', () => {
    expect(describeAuthError(null, '验证码发送失败，请稍后再试。')).toEqual({
      message: '验证码发送失败，请稍后再试。',
    });
  });

  it('translates a blacklisted phone number and keeps the provider code as detail', () => {
    const text = describeAuthError(
      {
        // 生产环境真实形态：genie-baas 把腾讯云 errcode 拼进 message。
        message:
          'send error code FailedOperation.PhoneNumberInBlacklist msg number on the blacklist',
      },
      '验证码发送失败，请稍后再试。',
    );
    expect(text.message).toContain('换一个手机号');
    expect(text.message).not.toContain('FailedOperation');
    expect(text.detail).toBe('FailedOperation.PhoneNumberInBlacklist');
  });

  it('accepts a bare provider code carried on error.code', () => {
    const text = describeAuthError(
      { message: 'number on the blacklist', code: 'FailedOperation.PhoneNumberInBlacklist' },
      '验证码发送失败，请稍后再试。',
    );
    expect(text.message).toContain('换一个手机号');
    expect(text.detail).toBe('FailedOperation.PhoneNumberInBlacklist');
  });

  it('explains rate limiting in Chinese instead of surfacing the raw message', () => {
    const text = describeAuthError(
      { message: 'LimitExceeded.PhoneNumberThirtySecondLimit', kind: 'rate-limited' },
      '验证码发送失败，请稍后再试。',
    );
    expect(text.message).toContain('30 秒后再试');
    expect(text.detail).toBe('LimitExceeded.PhoneNumberThirtySecondLimit');
  });

  it('maps transport-level kinds when no provider code is present', () => {
    expect(describeAuthError({ message: 'fetch failed', kind: 'network' }, 'x').message).toContain(
      '网络',
    );
    expect(
      describeAuthError({ message: 'upstream down', kind: 'backend-unavailable' }, 'x').message,
    ).toContain('稍后再试');
  });

  it('never echoes an untranslated English message, and omits detail when nothing is identifiable', () => {
    const text = describeAuthError(
      { message: 'send error code unknown msg something broke' },
      '验证码发送失败，请稍后再试。',
    );
    expect(text).toEqual({ message: '验证码发送失败，请稍后再试。' });
  });

  it('keeps an unrecognised provider code as detail for support', () => {
    const text = describeAuthError(
      { message: 'send error code FailedOperation.SomethingNew msg nope' },
      '验证码发送失败，请稍后再试。',
    );
    expect(text.message).toBe('验证码发送失败，请稍后再试。');
    expect(text.detail).toBe('FailedOperation.SomethingNew');
  });
});
