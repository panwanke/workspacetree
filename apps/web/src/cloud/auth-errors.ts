/**
 * 认证错误文案：把 SDK / 上游 provider 的错误翻译成用户能读懂、能行动的中文。
 *
 * 背景（2026-11-16 实测）：genie-baas 会把腾讯云短信的 errcode 原样拼进 message，
 * 例如 `send error code FailedOperation.PhoneNumberInBlacklist msg number on the
 * blacklist`。直接展示等于什么都没说；而 UI 层的兜底文案「请检查网络连接后重试」
 * 又会把「号码进黑名单」误判成网络问题。因此：
 *
 * - 先按 provider 错误码给出可操作建议；
 * - 再按 SDK 的 kind 兜底（限流 / 网络 / 服务不可用）；
 * - 都不认识时给中性中文，并把原始码放进 `detail` 供报障，绝不把英文原文当主文案。
 *
 * 这里只做「错误 → 文案」，不发请求、不读全局状态，便于单测。
 */
import type { CloudErrorLike } from './ports';

export interface AuthErrorText {
  /** 面向用户的主文案，必定是中文且可行动。 */
  message: string;
  /** 原始错误码/短标识，供用户报障或开发者排查；只在可识别时给出。 */
  detail?: string;
}

/**
 * 上游错误码形态：腾讯云短信的 `FailedOperation.X`、`InvalidParameterValue.X`、
 * `LimitExceeded.X`，以及 gotrue 风格的 `invalid_grant`。
 */
const PROVIDER_CODE =
  /(?:FailedOperation|InvalidParameter|InvalidParameterValue|LimitExceeded|UnauthorizedOperation)\.[A-Za-z]+|invalid_grant/;

/** 已知错误码 → 可操作文案。新增条目时同步补测试。 */
const PROVIDER_HINTS: Record<string, string> = {
  'FailedOperation.PhoneNumberInBlacklist':
    '该手机号收不到短信验证码：号码可能在退订或运营商的免打扰名单中。请换一个手机号登录，或联系管理员处理该号码。',
  'FailedOperation.PhoneNumberParseFail': '手机号格式无法识别，请检查后重试。',
  'InvalidParameterValue.IncorrectPhoneNumber': '手机号格式不正确，请检查后重试。',
  'LimitExceeded.PhoneNumberDailyLimit': '该手机号今日接收验证码次数已达上限，请明天再试。',
  'LimitExceeded.PhoneNumberThirtySecondLimit': '发送过于频繁，请 30 秒后再试。',
  'LimitExceeded.PhoneNumberOneHourLimit': '该手机号一小时内接收验证码次数过多，请稍后再试。',
  'FailedOperation.RequestLimitExceeded': '请求过于频繁，请稍后再试。',
  'FailedOperation.SignatureIncorrectOrUnapproved':
    '短信通道签名异常，暂时无法发送验证码，请联系管理员。',
  'FailedOperation.TemplateIncorrectOrUnapproved':
    '短信模板异常，暂时无法发送验证码，请联系管理员。',
  'FailedOperation.MissingSdkAppid': '短信通道未就绪，暂时无法发送验证码，请联系管理员。',
  invalid_grant: '登录凭据已失效，请重新获取验证码。',
};

/** SDK 归一化后的错误类型 → 文案。 */
const KIND_HINTS: Record<string, string> = {
  'rate-limited': '请求过于频繁，请稍后再试。',
  network: '网络异常，请检查网络连接后重试。',
  'backend-unavailable': '账号服务暂时不可用，请稍后再试。',
  unauthenticated: '登录状态已失效，请重新登录。',
  'permission-denied': '当前账号没有执行该操作的权限。',
  'not-found': '账号服务返回了未预期的结果，请稍后再试。',
  'invalid-request': '请求参数有误，请检查邮箱或手机号格式。',
};

function pickCode(error: CloudErrorLike): string | undefined {
  if (typeof error.code === 'string' && PROVIDER_CODE.test(error.code)) return error.code;
  const matched = PROVIDER_CODE.exec(error.message);
  return matched ? matched[0] : undefined;
}

/**
 * 归一化一条认证相关错误。
 *
 * @param error    SDK 返回的 error；为 null 时用 fallback（调用方自己知道语境）。
 * @param fallback 无错误对象、或错误完全不可识别时的兜底文案。
 */
export function describeAuthError(
  error: CloudErrorLike | null | undefined,
  fallback: string,
): AuthErrorText {
  if (!error) return { message: fallback };

  const code = pickCode(error);
  if (code && PROVIDER_HINTS[code]) return { message: PROVIDER_HINTS[code], detail: code };

  if (error.kind && KIND_HINTS[error.kind]) {
    return { message: KIND_HINTS[error.kind], detail: code };
  }

  // 不认识的上游错误：给中性中文，把原始码留作 detail；没有码就不暴露英文原文。
  return { message: fallback, detail: code };
}
