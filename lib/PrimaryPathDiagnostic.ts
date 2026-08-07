export type PrimaryPathDiagnostic = {
  gatewayId: string | undefined;
  edgeId: string | undefined;
  score: number[];
  status: 'accepted' | 'rejected-hard-defect' | 'rejected-quality';
};
