// ---------------------------------------------------------------------------
// Shared types used by both the frontend (src/) and Netlify Functions.
// ---------------------------------------------------------------------------

export type CourseStatus = 'draft' | 'published' | 'archived';

export type KnowledgeStatus =
  | 'not_uploaded'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'needs_review'
  | 'published';

export type AssessmentMode = 'ai' | 'admin' | 'mixed';

export type QuestionType = 'recall' | 'understanding' | 'application';

export type SlideState =
  | 'not_started'
  | 'explanation_in_progress'
  | 'explanation_completed'
  | 'assessment_pending'
  | 'assessment_in_progress'
  | 'corrective_required'
  | 'assessment_completed'
  | 'slide_completed';

export type SessionStatus = 'registered' | 'in_progress' | 'completed' | 'expired';

export interface SlideQuestion {
  position: 1 | 2 | 3;
  question_type: QuestionType;
  question: string;
  expected_answer: string;
  keywords: string[]; // mandatory answer keywords
}

export interface Slide {
  id: string;
  course_id: string;
  slide_number: number;
  title: string;
  learning_objective: string;
  key_message: string;
  teaching_points: string;       // mandatory teaching points (one per line)
  restricted_statements: string; // prohibited statements (one per line)
  assessment_mode: AssessmentMode;
  passing_score: number;         // 0..100
  max_attempts: number;
  active: boolean;
  display_order: number;
  asset_key: string | null;      // Netlify Blobs key for the slide visual
  asset_mime: string | null;
  knowledge_key: string | null;  // original knowledge document blob key
  knowledge_mime: string | null;
  knowledge_filename: string | null;
  knowledge_status: KnowledgeStatus;
  knowledge_error: string | null;
  questions: SlideQuestion[];
  updated_at: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  status: CourseStatus;
  current_version: number;
  expected_duration_minutes: number;
  inactivity_warning_seconds: number;
  inactivity_stop_seconds: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSection {
  heading: string;
  content: string;
}

export interface KnowledgePackage {
  slide_id: string;
  source_filename: string;
  extracted_at: string;
  sections: KnowledgeSection[];
  full_text: string;
  edited_by_admin: boolean;
}

/** Immutable snapshot of a slide inside a published course version. */
export interface PublishedSlide {
  slide_id: string;
  slide_number: number;
  title: string;
  learning_objective: string;
  key_message: string;
  teaching_points: string;
  restricted_statements: string;
  assessment_mode: AssessmentMode;
  passing_score: number;
  max_attempts: number;
  display_order: number;
  asset_key: string | null;
  asset_mime: string | null;
  knowledge_processed_key: string | null; // blob key of frozen knowledge package
  questions: SlideQuestion[];
}

export interface PublishedCourseSnapshot {
  course_id: string;
  version: number;
  title: string;
  description: string;
  expected_duration_minutes: number;
  inactivity_warning_seconds: number;
  inactivity_stop_seconds: number;
  slides: PublishedSlide[];
  published_at: string;
}

export interface AnswerAnalysis {
  accuracy: number;              // 0..100
  core_understanding: number;    // 0..100
  mandatory_points_included: string[];
  important_points_missed: string[];
  incorrect_statements: string[];
  application: number;           // 0..100
  keyword_hits: string[];
  keyword_misses: string[];
}

export interface AnswerScore {
  score: number;                 // weighted 0..100
  passed: boolean;
  analysis: AnswerAnalysis;
  feedback: string;              // concise corrective feedback
  corrective_question: string | null; // set when failed and attempts remain
}

export interface SlideProgressView {
  slide_id: string;
  state: SlideState;
  best_score: number | null;
  attempts_used: number;
  completed_at: string | null;
}

export interface SessionView {
  session_id: string;
  learner_name: string;
  course_version: number;
  status: SessionStatus;
  started_at: string;
  active_seconds: number;
  total_elapsed_seconds: number;
  current_slide_id: string | null;
  slides: SlideProgressView[];
  rating_submitted: boolean;
}

export interface GeminiSettings {
  configured: boolean;
  masked_key: string;            // e.g. "AIza••••••••3kQ"
  live_model: string;
  voice: string;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  store_raw_audio: boolean;
  data_retention_days: number;
}

export interface ReportRow {
  session_id: string;
  learner_name: string;
  designation: string;
  headquarter: string;
  employee_code: string | null;
  course_title: string;
  course_version: number;
  started_at: string;
  completed_at: string | null;
  total_elapsed_seconds: number;
  active_seconds: number;
  status: SessionStatus;
  slides_completed: number;
  slides_total: number;
  overall_score: number | null;
  rating_overall: number | null;
  rating_clarity: number | null;
  rating_usefulness: number | null;
  feedback: string | null;
  last_activity_at: string;
}

export const LIVE_MODELS = [
  'gemini-2.5-flash-native-audio-preview-09-2025',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-live-2.5-flash-preview',
] as const;

export const TRAINER_VOICES = [
  'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr',
] as const;

export const MAX_SLIDES = 20;
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
export const DOC_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MB
export const MAX_DOC_BYTES = 15 * 1024 * 1024;    // 15 MB
