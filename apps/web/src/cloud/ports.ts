/**
 * 云服务窄端口。
 *
 * 目的：让账号服务 / 云端项目仓库只依赖这些接口，不依赖 SDK 具体类型，
 * 因此可以在 node 环境下用内存 fake 做完整单元测试；SDK 适配集中在 client.ts。
 * 真实实现必须使用 @tencent-ai/workbuddy-cloud-sdk，不得手写 fetch('/.cloud/**')。
 */
import type { BranchFile } from '@workspacetree/schema';

export interface CloudIdentity {
  userId: string;
  label: string;
}

export interface CloudErrorLike {
  message: string;
  kind?: string;
  code?: string;
}

export interface CloudResultLike<T> {
  data: T | null;
  error: CloudErrorLike | null;
}

export interface CloudSessionLike {
  user: { id: string; email?: string; phone?: string; name?: string };
}

export interface OtpChallengeLike {
  verificationId: string;
  isExistingUser: boolean;
}

export type OtpChannel = 'email' | 'phone';

export interface OtpPendingChallenge extends OtpChallengeLike {
  channel: OtpChannel;
  value: string;
}

/** SDK auth 模块的最小投影，便于注入与测试。 */
export interface CloudAuthPort {
  getSession(): Promise<CloudResultLike<CloudSessionLike>>;
  sendOtp(
    credentials: { email: string } | { phone: string },
  ): Promise<CloudResultLike<OtpChallengeLike>>;
  verifyOtp(params: {
    verificationId: string;
    token: string;
    isExistingUser: boolean;
    email?: string;
    phone?: string;
  }): Promise<CloudResultLike<CloudSessionLike>>;
  signInWithOAuth(options: {
    provider: 'wechat' | 'workbuddy';
    redirectTo: string;
  }): Promise<CloudResultLike<{ url: string }>>;
  handleWechatWebCallback?(search?: string): Promise<CloudResultLike<CloudSessionLike>>;
  handleWorkBuddyCallback?(search?: string): Promise<CloudResultLike<CloudSessionLike>>;
  signOut(): Promise<CloudResultLike<null>>;
  onAuthStateChange(
    callback: (event: string, session: CloudSessionLike | null) => void,
  ): () => void;
}

/** 云端单行记录；owner_id 由数据库 DEFAULT auth.uid() 填充，前端绝不传。 */
export interface CloudProjectRow {
  project_id: string;
  title: string;
  active_branch: string;
  node_count: number;
  payload: BranchFile;
  updated_at?: string;
}

export interface CloudProjectSummaryRow {
  project_id: string;
  title: string;
  active_branch: string;
  node_count: number;
  updated_at?: string;
}

export interface WriteOutcome {
  affected: number;
}

export interface CloudProjectTablePort {
  list(): Promise<CloudResultLike<CloudProjectSummaryRow[]>>;
  get(projectId: string): Promise<CloudResultLike<CloudProjectRow | null>>;
  upsert(row: CloudProjectRow): Promise<CloudResultLike<WriteOutcome>>;
  remove(projectId: string): Promise<CloudResultLike<WriteOutcome>>;
}

export class CloudServiceError extends Error {
  constructor(
    message: string,
    readonly kind:
      'unconfigured' | 'unauthenticated' | 'permission' | 'network' | 'conflict' | 'unknown',
  ) {
    super(message);
    this.name = 'CloudServiceError';
  }
}

export function describeCloudError(error: CloudErrorLike): string {
  switch (error.kind) {
    case 'unauthenticated':
      return '登录状态已失效，请重新登录。';
    case 'permission-denied':
      return '没有权限访问该账号下的项目。';
    case 'network':
    case 'backend-unavailable':
      return '云服务暂时不可用，请检查网络后重试。项目未丢失，仍在本地。';
    case 'not-found':
      return '云端项目不存在或已被删除。';
    case 'rate-limited':
      return '请求过于频繁，请稍后再试。';
    case 'credits-exhausted':
      return '云服务额度已用尽，请稍后或在管理面板处理配额。';
    default:
      switch (error.code) {
        case '42P01':
          return '云端项目表尚未创建，请先在管理面板执行 docs/cloud-schema.sql。';
        case '42501':
          return '没有权限写入该账号下的项目。';
        case '23505':
          return '同名项目已存在，请刷新后重试。';
        default:
          return error.message || '云服务请求失败，请稍后重试。';
      }
  }
}
