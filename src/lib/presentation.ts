export type PresentationSettings = {
  autoAdvance: boolean;
  showCaptions: boolean;
  questionPolicy: "manual";
};

export type PresentationSlide = {
  id: string;
  page: number;
  imageUrl: string;
  script: string;
  notes: string;
  expectedDurationSeconds: number;
};

export type PresentationProject = {
  id: string;
  title: string;
  sourcePdfName: string;
  createdAt: string;
  updatedAt: string;
  settings: PresentationSettings;
  slides: PresentationSlide[];
  knowledge: string;
  qa: string;
};

export type PresentationProjectSummary = Pick<
  PresentationProject,
  "id" | "title" | "sourcePdfName" | "createdAt" | "updatedAt"
> & {
  slideCount: number;
};

export type PresentationProjectListResponse = {
  projects: PresentationProjectSummary[];
};

export type PreparedSpeechEntry = {
  slideIndex: number;
  paragraphIndex: number;
  text: string;
  emotion: "normal" | "happy" | "angry" | "surprised" | "sad";
  audioUrl: string;
  contentType: string;
  durationMs: number;
};

export type PreparedSpeechManifest = {
  projectId: string;
  preparedAt: string;
  entries: PreparedSpeechEntry[];
};

export type PresentationLiveStatus = "idle" | "ready" | "presenting" | "paused" | "finished";

export type PresentationLiveState = {
  enabled: boolean;
  status: PresentationLiveStatus;
  projectId: string;
  projectTitle: string;
  slideIndex: number;
  slideCount: number;
  slideImageUrl: string;
  caption: string;
  updatedAt: number;
};

export const defaultPresentationLiveState = (): PresentationLiveState => ({
  enabled: false,
  status: "idle",
  projectId: "",
  projectTitle: "",
  slideIndex: 0,
  slideCount: 0,
  slideImageUrl: "",
  caption: "",
  updatedAt: 0,
});
