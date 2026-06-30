import { detectStack } from "./detect.js";
import { checkSecrets } from "./checks/secrets.js";
import { checkRowLevelSecurity } from "./checks/rls.js";
import { checkAuthOnRoutes } from "./checks/auth-routes.js";
import { checkDependencies } from "./checks/dependencies.js";
import { checkDeployability } from "./checks/deployability.js";
import { checkObservability } from "./checks/observability.js";
import { checkCors } from "./checks/cors.js";
import { checkRateLimiting } from "./checks/rate-limit.js";
import { checkInputValidation } from "./checks/validation.js";
import { checkStorageBuckets } from "./checks/storage.js";
import type { Finding, StackInfo } from "./types.js";

export interface ScanResult {
  stack: StackInfo;
  findings: Finding[];
}

export async function runScan(root: string): Promise<ScanResult> {
  const stack = detectStack(root);

  const findingGroups = await Promise.all([
    checkSecrets(stack),
    checkRowLevelSecurity(stack),
    checkAuthOnRoutes(stack),
    checkDependencies(stack),
    checkDeployability(stack),
    checkObservability(stack),
    checkCors(stack),
    checkRateLimiting(stack),
    checkInputValidation(stack),
    checkStorageBuckets(stack),
  ]);

  const findings = findingGroups.flat();
  return { stack, findings };
}
