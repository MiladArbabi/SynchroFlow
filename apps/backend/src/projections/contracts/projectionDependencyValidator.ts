import { projectionDependencies } from './projectionDependencies.js';

export function validateProjectionDependencyGraph() {

  const graph = new Map<string, string[]>();

  for (const node of projectionDependencies) {
    graph.set(node.projection, node.dependsOn ?? []);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string) {

    if (stack.has(node)) {
      throw new Error(
        `[ProjectionDependencyGraph] cycle detected involving ${node}`
      );
    }

    if (visited.has(node)) return;

    stack.add(node);

    const deps = graph.get(node) ?? [];

    for (const dep of deps) {

      if (!graph.has(dep)) {
        throw new Error(
          `[ProjectionDependencyGraph] ${node} depends on unknown projection ${dep}`
        );
      }

      dfs(dep);
    }

    stack.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    dfs(node);
  }

  console.debug('[ProjectionDependencyGraph] Dependency graph verified');

}

export function validateExecutionOrder(order: string[]) {

  const position = new Map<string, number>();

  order.forEach((p, i) => position.set(p, i));

  for (const node of projectionDependencies) {

    const current = position.get(node.projection);

    if (current === undefined) {
      throw new Error(
        `[ProjectionDependencyGraph] projection not executed: ${node.projection}`
      );
    }

    for (const dep of node.dependsOn ?? []) {

      const depPos = position.get(dep);

      if (depPos === undefined) {
        throw new Error(
          `[ProjectionDependencyGraph] missing dependency execution: ${dep}`
        );
      }

      if (depPos > current) {
        throw new Error(
          `[ProjectionDependencyGraph] invalid order: ${node.projection} runs before ${dep}`
        );
      }
    }
  }

}