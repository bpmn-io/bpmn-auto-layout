export const HORIZONTAL_GAP = 100;
export const VERTICAL_GAP = 80;
export const OUTER_MARGIN = 80;
export const SUB_PROCESS_PADDING = 40;
export const ROUTING_MARGIN = 20;
export const MESSAGE_FLOW_BEND_PENALTY = VERTICAL_GAP;
export const PARTICIPANT_HEADER_WIDTH = 30;
export const LANE_CONTENT_PADDING = 40;
export const ANNOTATION_MIN_WIDTH = 100;
export const ANNOTATION_MAX_WIDTH = 340;
export const ANNOTATION_WIDTH_STEP = 40;
export const ANNOTATION_CHARACTER_WIDTH = 7;
export const ANNOTATION_LINE_HEIGHT = 14;
export const ANNOTATION_PADDING = 10;
export const GROUP_PADDING = 40;
export const EXTERNAL_LABEL_WIDTH = 90;
export const EXTERNAL_LABEL_LINE_HEIGHT = 14;
export const EXTERNAL_LABEL_CHARACTER_WIDTH = 7;
export const EXTERNAL_LABEL_UPPERCASE_WIDTH = 9;
export const EXTERNAL_LABEL_WIDE_CHARACTER_WIDTH = 11;
export const EXTERNAL_LABEL_SPACE_WIDTH = 4;
export const EXTERNAL_LABEL_CLEARANCE = 5;
export const FLOW_LABEL_INDENT = 15;

// Participant, sub-process, and lane sizing policy.
export const MIN_PARTICIPANT_WIDTH = 300;
export const MIN_PARTICIPANT_HEIGHT = 150;
export const MIN_SUB_PROCESS_WIDTH = 140;
export const MIN_SUB_PROCESS_HEIGHT = 120;

// Distinct from VERTICAL_GAP despite the equal current value: this is the
// vertical extent of a semantic band, not an inter-shape gap.
export const SEMANTIC_BAND_HEIGHT = 80;
export const MIN_LANE_CONTENT_WIDTH = 300;
export const MIN_LANE_HEIGHT = 60;
export const BOUNDARY_EVENT_SPACING = 8;

// Text annotation sizing policy.
export const ANNOTATION_MIN_HEIGHT = 40;
export const ANNOTATION_TARGET_ASPECT_RATIO = 3;
export const ANNOTATION_ASPECT_RATIO_PENALTY_SCALE = 100;

// Artifact placement search policy.
export const MAX_ARTIFACT_SEARCH_OFFSET = 400;
export const MAX_ARTIFACT_GAP_STEPS = 4;
export const NON_STRAIGHT_ARTIFACT_ASSOCIATION_PENALTY = VERTICAL_GAP;
export const BOUNDARY_EVENT_ARTIFACT_CLEARANCE = 3 * ROUTING_MARGIN;
export const EXPANDED_SUBPROCESS_ANNOTATION_CLEARANCE = 2 * ROUTING_MARGIN;
export const EXPANDED_SUBPROCESS_LABEL_HEIGHT = 28;
export const EXPANDED_SUBPROCESS_LABEL_PADDING = 7;
export const MAX_LABEL_SEARCH_STEPS = 100;

// Message flow channel policy. Kept as distinct constants from each other
// despite equal current values because they represent independent policies:
// the docking offset from a node's center versus the spacing between
// parallel message flow channels.
export const MESSAGE_FLOW_SIDE_OFFSET = 10;
export const MESSAGE_FLOW_CHANNEL_SPACING = 10;
export const MESSAGE_FLOW_CHANNEL_WIDTH_DIVISOR = 4;
export const MAX_EXHAUSTIVE_PARTICIPANT_COUNT = 8;
export const MESSAGE_FLOW_OBSTACLE_INSET = 1;

// Sequence flow routing search policy.
export const MAX_ROUTE_SEARCH_ATTEMPTS = 100;
export const MAX_LOCAL_U_CHANNEL_ATTEMPTS = 20;

// Distinct from MESSAGE_FLOW_OBSTACLE_INSET despite the equal current value:
// this inset applies to sequence flow obstacle checks, not message flows.
export const ROUTE_OBSTACLE_INSET = 1;
export const VISIBILITY_GRAPH_TURN_PENALTY = 1;
export const SEGMENT_INTERSECTION_EPSILON = 1e-6;
