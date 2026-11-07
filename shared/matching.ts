export function matchingRubric(hasResume: boolean) {
  return {
    role: { label: 'Role alignment', maxPoints: hasResume ? 25 : 35 },
    location: { label: 'Location and work setup', maxPoints: hasResume ? 20 : 25 },
    experience: { label: hasResume ? 'Resume experience and seniority' : 'Preferred experience level', maxPoints: hasResume ? 15 : 20 },
    skills: { label: 'Resume skills and qualifications', maxPoints: hasResume ? 25 : 0 },
    preferences: { label: 'Industry and other preferences', maxPoints: hasResume ? 15 : 20 },
  };
}
