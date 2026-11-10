/**
 * `@soloengine/cloud-control` 的公开面：控制面契约、存储、放置、租约与服务。
 *
 * @module @soloengine/cloud-control
 */

export {
  CloudControlError, DEFAULT_LEASE_TTL_MS, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
  type LeaseAcquireResult, type NodeLoad, type NodeRecord, type NodeState, type NodeView,
  type PlacementCandidate, type PlacementDecision, type PlacementRequest, type SessionLease,
  type WorkspaceFileEntry,
} from './contracts.ts'
export { placeSession } from './placement.ts'
export {
  evaluateEgress, type EgressAttempt, type EgressDenyReason, type EgressRule, type NetworkPolicy,
  type PolicyDecision, type SessionPhase,
} from './network-policy.ts'
export {
  AdmissionController, type AdmissionResult, type QuotaPolicy, type UsageAggregate, type UsageReport,
} from './quota.ts'
export {
  decideLifecycle, DEFAULT_LIFECYCLE_POLICY, planEvictions, type LifecycleAction, type LifecyclePolicy,
  type PauseMode, type SessionRunState, type SessionSnapshot, type SessionTier,
} from './lifecycle.ts'
export {
  overflowEligible, planDrain, planRollingUpgrade, planScale,
  type DrainPlan, type ScaleDecision, type ScalePolicy, type UpgradeBatch,
} from './elasticity.ts'
export { ControlPlane, type ControlPlaneOptions, type DrainResult, type RegisterNodeInput } from './service.ts'
export { ControlStore } from './store.ts'
export { type ControlRepository, type RepositoryLeaseResult } from './repository.ts'
export { createControlServer } from './http.ts'
export { CloudGateway, createGatewayServer, type CloudGatewayOptions, type GatewayRoute } from './gateway.ts'
export { localControlApi, type ControlApi, type NodeControlApi } from './api.ts'
export { RemoteControl } from './client.ts'
