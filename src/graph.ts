import { graph } from "lobx";
import { Graph } from "lobx";

const lobxGraph = graph();

export function getGraph(): Graph {
	return lobxGraph;
}
