import type { CanvasOperationAvailability, CanvasOperationId } from "./types/editor-session-types";
import type { WorldDocument, WorldEntity } from "../document/world-document";
import type {
	ClientPixelPoint,
} from "../shared/client-pixel";
import type {
	GridPoint,
	GridRect,
} from "../shared/grid";
import type {
	LogisticsDraftEndpoint,
	LogisticsDraftReadonlyState,
	LogisticsKind,
} from "../shared/logistics";
import type {
	EntityCollectionType,
  EditorViewState,
	EntityCollectionGeometry,
	EntityPlacementValidationResult,
} from "./types/editor-types";
import type { EditorBaseDocumentSummary } from "./editor-document";
import type { EditorHistoryRecord } from "./editor-history";
import type { RegionalDarkPipeLink } from "../shared/dark-pipe-link";

export interface EditorQuery {
	getOperationAvailability(operation: CanvasOperationId): CanvasOperationAvailability;
	/** 仅通知新提交的本地编辑；不回放加载、远端同步、撤销或重做。 */
	subscribeCommittedEdits(listener: (record: EditorHistoryRecord) => void): () => void;
	getEntityById(entityId: string): WorldEntity | null;
	listEntities(): readonly WorldEntity[];
	listPowerRangeProvidersCoveringGridRect(gridRect: GridRect): readonly WorldEntity[];
	findEntityAtClientPixelPoint(
		clientPixelPoint: ClientPixelPoint,
    viewport: EditorViewState,
    options?: { readonly includeDrafts?: boolean },
	): WorldEntity | null;
	findEntityCollectionGridRect(
		collectionType: EntityCollectionType,
	): GridRect | null;
	findEntityCollectionGeometry(
		collectionType: EntityCollectionType,
	): EntityCollectionGeometry | null;
	getEntityPlacementValidation(entityId: string): EntityPlacementValidationResult;

	resolveLogisticsDraftState(): LogisticsDraftReadonlyState | null;
	findLogisticsDraftEndpointAtGridPoint(
		gridPoint: GridPoint,
		kind: LogisticsKind,
	): LogisticsDraftEndpoint | null;
	canCreateLogisticsDraftStartHere(gridPoint: GridPoint, kind: LogisticsKind): boolean;
	/** 该格上指定族的传送带节/管道节；没有时返回 null。 */
	findTransportLineAtGridPoint(gridPoint: GridPoint, kind: LogisticsKind): WorldEntity | null;
	/** 位于端口内侧格的设备端口（输入或输出，传送带或管道族）；非端口格返回 null。 */
	findDevicePortAtGridPoint(gridPoint: GridPoint, connection?: {
		readonly kind: LogisticsKind;
		readonly direction: "input" | "output";
		readonly outsideGridPoint: GridPoint;
	}): {
		readonly kind: LogisticsKind;
		readonly endpoint: Extract<LogisticsDraftEndpoint, { readonly type: "device-port" }>;
	} | null;
	listBaseDocumentSummaries(): Promise<readonly EditorBaseDocumentSummary[]>;
/**
 * 读取指定基地的最新持久化世界文档。当前内存文档不在此查询范围内；
 * 调用方负责用当前内存文档覆盖当前基地。
 * 订正（2026-09-25，REQ-038）：返回 Editor 最新内存版本；仅未加载基地读取存储，调用方无需再次覆盖。
 */
	readLatestBaseDocuments(baseIds: readonly string[]): Promise<readonly WorldDocument[]>;
	/** 当前区域文档派生的跨基地暗管关系；多基地关闭时为空。 */
	getRegionalDarkPipeLinks(): readonly RegionalDarkPipeLink[];
	/** 文档加载、修改、同步或释放通知；不暴露可写文档集合。 */
	subscribeBaseDocuments(listener: (baseIds: readonly string[]) => void): () => void;
	findRegionEntityIds(
		regionId: string,
		relation: "contained" | "boundary",
	): readonly string[];
}
