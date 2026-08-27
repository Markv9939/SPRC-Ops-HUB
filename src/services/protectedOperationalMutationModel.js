export function protectedWorkflowClaimEnabled(claims = {}, workflowId) {
  return Number(claims.workflowSecurityVersion || 0) === 6
    && Array.isArray(claims.secureWorkflows)
    && claims.secureWorkflows.includes(workflowId)
}
