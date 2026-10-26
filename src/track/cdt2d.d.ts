declare module "cdt2d" {
  export default function cdt2d(points: number[][], edges: number[][], options?: { exterior?: boolean; interior?: boolean; delaunay?: boolean }): number[][];
}
