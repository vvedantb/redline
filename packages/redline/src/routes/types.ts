export type Confidence = 'high' | 'medium' | 'low';

export interface DetectedRoute {
  path: string;
  sourceFile: string;
  confidence: Confidence;
  reason: string;
}
