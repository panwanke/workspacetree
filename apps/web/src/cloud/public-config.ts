/**
 * 云服务公开配置 —— 唯一注入点。
 *
 * 下方三个值逐字来自 `workbuddy_cloud_service`(action=activate) 返回的 `publicConfig`
 * （应用 WorkspaceTree / wbapp_dH26wsJCg55VpWicSNpTDE，2026-11-15 激活成功）。
 * 它们是可公开下发给前端的值，不含任何服务端密钥。
 *
 * - endpoint          → publicConfig.endpoint
 * - oauthRelayBaseUrl → publicConfig.oauthRelayBaseUrl
 * - publishableKey    → publicConfig.publishableKey
 *
 * 严禁：从 window.location / 环境变量 / 约定拼接推导 endpoint，或填入猜测的域名。
 * endpoint 与发布域名同源；publishableKey 由服务端按 Origin 精确校验，
 * 因此带账号登录的版本必须部署在该应用保留的 WorkBuddy HTTPS 域名上。
 */
export interface CloudPublicConfig {
  endpoint: string;
  oauthRelayBaseUrl: string;
  publishableKey: string;
}

export const publicConfig: CloudPublicConfig = {
  endpoint: 'https://wbapp-dh26wsjcg55vpwicsnptde.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_dH26wsJCg55VpWicSNpTDE_go86tDWV7A0GJKNYqCmQcjMFousZoRub',
};

export const CLOUD_NOT_CONFIGURED_MESSAGE =
  '云服务尚未配置：请先在部署阶段把 publicConfig 填入 cloud/public-config.ts 并重新构建。当前项目仍保存在本浏览器。';

export function isCloudConfigured(config: CloudPublicConfig = publicConfig): boolean {
  return Boolean(
    config.endpoint.trim() && config.oauthRelayBaseUrl.trim() && config.publishableKey.trim(),
  );
}
