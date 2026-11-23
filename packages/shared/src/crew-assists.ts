export interface CrewAssist {
  kind: "call" | "rescue";
  source: string;
  target: string;
  station: string;
}
