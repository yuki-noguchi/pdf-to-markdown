export type JobStatus = "UPLOADING" | "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export interface JobRecord {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  originalFileName: string;
  totalPages: number | null;
  currentPage: number;
  progress: number;
  resultPath: string | null;
  errorMessage: string | null;
}

export interface ProgressEvent {
  type: "progress";
  currentPage: number;
  progress: number;
  message: string;
}

export interface DoneEvent {
  type: "done";
  resultMarkdown: string;
}

export interface FailedEvent {
  type: "failed";
  message: string;
}

export type JobEvent = ProgressEvent | DoneEvent | FailedEvent;
