export interface MSTeamsWebhook {
  "@type": string;
  "@context": string;
  themeColor: string;
  summary: string;
  sections: Section[];
  potentialAction: PotentialAction[];
}

export interface Section {
  activityTitle: string;
  activitySubtitle: string;
  activityImage: string;
  facts: Fact[];
  markdown: boolean;
}

export interface Fact {
  name: string;
  value: string;
}

export interface PotentialAction {
  "@type": string;
  name: string;
  inputs?: Input[];
  actions?: Action[];
  targets?: Target[];
}

export interface Input {
  "@type": string;
  id: string;
  title: string;
  isMultiSelect?: string;
  choices?: Choice[];
  isMultiline?: boolean;
}

export interface Choice {
  display: string;
  value: string;
}

export interface Action {
  "@type": string;
  name: string;
  target: string;
}

export interface Target {
  os: string;
  uri: string;
}
