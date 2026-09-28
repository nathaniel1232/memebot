export function canAutoLaunch({ enabled, liveDeployEnabled, credentialsReady, budgetAllowed, candidate }) {
  return enabled === true
    && liveDeployEnabled === true
    && credentialsReady === true
    && budgetAllowed === true
    && candidate?.status === "needs_approval"
    && candidate.researchReview?.verdict === "shortlisted"
    && candidate.researchReview?.risk === "low"
    && candidate.originalMedia === true
    && candidate.qualityGate?.pass === true
    && candidate.safety?.hardBlock !== true;
}
