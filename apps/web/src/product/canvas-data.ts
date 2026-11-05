/**
 * 画布可用工具清单不再静态复刻（PRD-02 FR-CANVAS-014「工具多选来自实时注册」）：
 * 编辑器经 `GET /api/solo/tools`（host 以原生注入点挂载的 harness 实时注册集合）取得。
 */

/** 网格吸附步长（px）。 */
export const GRID_SIZE = 16

/**
 * 对齐辅助线的判定阈值（px）。
 *
 * 与网格步长同量级：比 16px 网格细一档，用户「靠近」同伴的边线时才吸附，
 * 不会把自由摆放也一并拉直（PRD-02 FR-CANVAS-010：拖到**靠近**同伴边线才出辅助线）。
 */
export const ALIGN_THRESHOLD = 6

/** 对齐锚点：节点框的左/中/右与上/中/下。 */
export interface AlignAnchors {
  /** 竖直方向的三条锚线（左、水平中心、右）。 */
  xs: number[]
  /** 水平方向的三条锚线（上、垂直中心、下）。 */
  ys: number[]
}

/** 一个可参与对齐的节点框（坐标 = 左上角）。 */
export interface AlignBox {
  /** 节点标识（用于排除自身）。 */
  id: string
  /** 左上角 x。 */
  x: number
  /** 左上角 y。 */
  y: number
  /** 节点高度（注释节点与 Agent 节点不同）。 */
  height: number
  /** 节点宽度（省略时取 {@link NODE_WIDTH}；注释节点更窄）。 */
  width?: number
}

/** 一次对齐的结果。 */
export interface AlignOutcome {
  /** 校正后的 x（吸附到同伴边线）。 */
  x: number
  /** 校正后的 y。 */
  y: number
  /** 需要画出的竖直辅助线 x 坐标。 */
  vertical: number[]
  /** 需要画出的水平辅助线 y 坐标。 */
  horizontal: number[]
}

/**
 * 取一个节点框的三组竖直/水平锚线。
 * @param box - 节点框。
 * @returns 锚线集合。
 */
export function alignAnchors(box: AlignBox): AlignAnchors {
  const width = box.width ?? NODE_WIDTH
  return {
    xs: [box.x, box.x + width / 2, box.x + width],
    ys: [box.y, box.y + box.height / 2, box.y + box.height],
  }
}

/**
 * 把拖拽中的节点对齐到同伴节点的边线（PRD-02 FR-CANVAS-010/011）。
 *
 * 判据是「最近的同伴锚线距离 ≤ 阈值」：命中则把该轴吸附到那条锚线并把锚线坐标作为辅助线
 * 返回；两轴各自独立判定（可同时命中竖直与水平，也可只有一轴命中）。未命中则原样返回该轴
 * 坐标、不给辅助线——不命中就不该动手（自由摆放是合法状态）。
 *
 * @param candidate - 拖拽中的节点框。
 * @param peers - 其余节点框（自身会被按 id 排除）。
 * @param threshold - 命中阈值（px）。
 * @returns 校正后的坐标与要画的辅助线。
 */
export function alignToPeers(
  candidate: AlignBox,
  peers: readonly AlignBox[],
  threshold: number = ALIGN_THRESHOLD,
): AlignOutcome {
  const own = alignAnchors(candidate)
  const others = peers.filter(peer => peer.id !== candidate.id)
  /**
   * 在某轴上找最近命中：返回「需要施加的位移」与该轴辅助线坐标。
   * @param ownAnchors - 自身锚线。
   * @param peerAnchorsOf - 取同伴同轴锚线。
   * @returns 位移与辅助线（未命中则位移 0、辅助线为空）。
   */
  const nearest = (
    ownAnchors: number[],
    peerAnchorsOf: (peer: AlignBox) => number[],
  ): { delta: number; guides: number[] } => {
    let best: { delta: number; at: number } | undefined
    for (const peer of others) {
      for (const anchor of peerAnchorsOf(peer)) {
        for (const mine of ownAnchors) {
          const distance = Math.abs(anchor - mine)
          if (distance > threshold) continue
          // 等价距离时取更靠近原点的锚线，保证同一手势的判定稳定（可复现）。
          const better = best === undefined
            || distance < Math.abs(best.delta)
            || (distance === Math.abs(best.delta) && anchor < best.at)
          if (better) best = { delta: anchor - mine, at: anchor }
        }
      }
    }
    return best === undefined ? { delta: 0, guides: [] } : { delta: best.delta, guides: [best.at] }
  }

  const verticalHit = nearest(own.xs, peer => alignAnchors(peer).xs)
  const horizontalHit = nearest(own.ys, peer => alignAnchors(peer).ys)
  return {
    x: candidate.x + verticalHit.delta,
    y: candidate.y + horizontalHit.delta,
    vertical: verticalHit.guides,
    horizontal: horizontalHit.guides,
  }
}

/** 节点外框宽度（与 editor.module.css 的 .node 宽度一致）。 */
export const NODE_WIDTH = 220
/** 注释节点外框宽度（与 editor.module.css 的 .nodeNoteNode 一致）。 */
export const NOTE_WIDTH = 190

/** 吸附到网格。 */
export function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}
