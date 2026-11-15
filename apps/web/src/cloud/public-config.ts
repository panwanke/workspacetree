/**
 * 云服务公开配置 —— 唯一注入点。
 *
 * ⚠️ 本轮只完成代码、不部署，因此下方三个值保持空字符串。
 * 部署时把 `workbuddy_cloud_service`(action=activate) 返回的 `publicConfig`
 * 三个字段逐字填入本对象即可；它们是可公开下发给前端的值，不含任何服务端密钥。
 *
 * - endpoint          → publicConfig.endpoint
 * - oauthRelayBaseUrl → publicConfig.oauthRelayBaseUrl
 * - publishableKey    → publicConfig.publishableKey
 *
 * 严禁：从 window.location / 环境变量 / 约定拼接推导 endpoint，或填入猜测的域名。
 * 未配置时 isCloudConfigured() 为 false，应用保持「本地游客模式」，
 * 不创建任何假账号、假会话或本地伪造身份。
 */
export interface CloudPublicConfig {
  endpoint: string;
  oauthRelayBaseUrl: string;
  publishableKey: string;
}

export const publicConfig: CloudPublicConfig = {
  endpoint: '',
  oauthRelayBaseUrl: '',
  publishableKey: '',
};

export const CLOUD_NOT_CONFIGURED_MESSAGE =
  '云服务尚未配置：请先在部署阶段把 publicConfig 填入 cloud/public-config.ts 并重新构建。当前项目仍保存在本浏览器。';

export function isCloudConfigured(config: CloudPublicConfig = publicConfig): boolean {
  return Boolean(
    config.endpoint.trim() && config.oauthRelayBaseUrl.trim() && config.publishableKey.trim(),
  );
}
