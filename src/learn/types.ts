import type { QuestionType, SessionStatus, SlideState } from '../../shared/types';

export interface LearnSlide {
  slide_id: string;
  slide_number: number;
  title: string;
  learning_objective: string;
  key_message: string;
  display_order: number;
  has_asset: boolean;
  passing_score: number;
  max_attempts: number;
  questions: Array<{ position: number; question_type: QuestionType; question: string }>;
}

export interface LearnCourse {
  title: string;
  description: string;
  version: number;
  expected_duration_minutes: number;
  inactivity_warning_seconds: number;
  inactivity_stop_seconds: number;
  slides: LearnSlide[];
}

export interface LearnSession {
  session_id: string;
  status: SessionStatus;
  started_at: string;
  total_elapsed_seconds: number;
  active_seconds: number;
  inactive_seconds: number;
  current_slide_id: string | null;
  resume_state: Record<string, unknown>;
  rating_submitted: boolean;
}

export interface ProgressRow {
  slide_id: string;
  state: SlideState;
  best_score: number | null;
  completed_at: string | null;
}

export interface AttemptRow {
  slide_id: string;
  question_position: number;
  attempt_number: number;
  is_corrective: boolean;
  passed: boolean | null;
  score: number | null;
  feedback: string | null;
  question: string;
}

export interface CoursePayload {
  session: LearnSession;
  course: LearnCourse;
  progress: ProgressRow[];
  attempts: AttemptRow[];
  privacy: { store_raw_audio: boolean; data_retention_days: number };
}
