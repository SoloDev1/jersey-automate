import { prisma } from '../../core/database/prisma.js';
import { normalizeTeamName } from './catalog.repository.js';

export interface TeamMatchResult {
  matchType: 'EXACT_MATCH' | 'AMBIGUOUS_MATCH' | 'NO_MATCH';
  team?: string;
  candidateTeams: string[];
}

export const POPULAR_CLUBS = [
  'Arsenal',
  'Chelsea',
  'Manchester City',
  'Manchester United',
  'Real Madrid',
  'Barcelona',
  'Liverpool'
];

function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[bn][an];
}

export const catalogMatcher = {
  /**
   * Matches a raw user team query against the active catalog.
   * Handles club aliases, fuzzy matching, and disambiguation.
   */
  async matchTeam(organizationId: string, rawQuery: string): Promise<TeamMatchResult> {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      return { matchType: 'NO_MATCH', candidateTeams: [] };
    }

    const normalized = normalizeTeamName(trimmed);

    // 1. Direct query against active jerseys in database
    const directMatches = await prisma.jersey.findMany({
      where: {
        organizationId,
        isActive: true,
        OR: [
          { team: { contains: normalized, mode: 'insensitive' } },
          { team: { contains: trimmed, mode: 'insensitive' } }
        ]
      },
      select: { team: true },
      distinct: ['team']
    });

    let candidateTeams = Array.from(new Set(directMatches.map((r) => r.team)));

    // 2. If no direct match on team field, try matching across title
    if (candidateTeams.length === 0) {
      const titleMatches = await prisma.jersey.findMany({
        where: {
          organizationId,
          isActive: true,
          title: { contains: normalized, mode: 'insensitive' }
        },
        select: { team: true },
        distinct: ['team']
      });
      candidateTeams = Array.from(new Set(titleMatches.map((r) => r.team)));
    }

    // 3. Multi-token fallback if query is multiple words (e.g. "Hull City")
    if (candidateTeams.length === 0 && trimmed.includes(' ')) {
      const tokens = trimmed.split(/\s+/).filter((t) => t.length >= 3);
      if (tokens.length > 0) {
        const tokenMatches = await prisma.jersey.findMany({
          where: {
            organizationId,
            isActive: true,
            OR: tokens.map((token) => ({
              team: { contains: token, mode: 'insensitive' }
            }))
          },
          select: { team: true },
          distinct: ['team']
        });
        candidateTeams = Array.from(new Set(tokenMatches.map((r) => r.team)));
      }
    }

    // 4. Fuzzy typo matching (e.g. "aton" -> "Aston Villa", "arsnal" -> "Arsenal")
    if (candidateTeams.length === 0 && trimmed.length >= 3) {
      const allActiveJerseys = await prisma.jersey.findMany({
        where: { organizationId, isActive: true },
        select: { team: true },
        distinct: ['team']
      });

      const queryLower = trimmed.toLowerCase();
      const scoredCandidates: Array<{ team: string; score: number }> = [];

      for (const item of allActiveJerseys) {
        const teamName = item.team;
        const teamLower = teamName.toLowerCase();

        // Check full team name similarity
        const fullDist = levenshteinDistance(queryLower, teamLower);
        const maxLen = Math.max(queryLower.length, teamLower.length);
        const fullScore = 1 - fullDist / maxLen;

        // Check each word in the team name (e.g., "aton" vs "Aston")
        let bestTokenScore = 0;
        const teamTokens = teamLower.split(/\s+/);
        for (const token of teamTokens) {
          if (token.length >= 3) {
            const tokenDist = levenshteinDistance(queryLower, token);
            const tokenScore = 1 - tokenDist / Math.max(queryLower.length, token.length);
            if (tokenScore > bestTokenScore) bestTokenScore = tokenScore;
          }
        }

        const maxScore = Math.max(fullScore, bestTokenScore);
        if (maxScore >= 0.70 || (queryLower.length >= 4 && bestTokenScore >= 0.65)) {
          scoredCandidates.push({ team: teamName, score: maxScore });
        }
      }

      scoredCandidates.sort((a, b) => b.score - a.score);
      candidateTeams = scoredCandidates.map((c) => c.team);
    }

    // 5. Evaluate disambiguation outcome
    if (candidateTeams.length === 0) {
      return {
        matchType: 'NO_MATCH',
        candidateTeams: []
      };
    }

    // Check if one candidate is an exact case-insensitive match to normalized or trimmed
    const exactMatch = candidateTeams.find(
      (t) =>
        t.toLowerCase() === normalized.toLowerCase() ||
        t.toLowerCase() === trimmed.toLowerCase()
    );

    // If an exact match is found and candidate list is small (or exactly 1), prioritize it
    if (exactMatch && candidateTeams.length === 1) {
      return {
        matchType: 'EXACT_MATCH',
        team: exactMatch,
        candidateTeams: [exactMatch]
      };
    }

    // If only 1 team matches partially (e.g. "Man City" -> "Manchester City")
    if (candidateTeams.length === 1) {
      return {
        matchType: 'EXACT_MATCH',
        team: candidateTeams[0],
        candidateTeams
      };
    }

    // If user typed an exact club name among multiple partials (e.g. user typed "Arsenal" and we have "Arsenal", "Arsenal Women")
    if (exactMatch) {
      return {
        matchType: 'EXACT_MATCH',
        team: exactMatch,
        candidateTeams: [exactMatch]
      };
    }

    // Ambiguity exists (e.g. query "Hull" matches "Hull City" and "Hull United", or "Manchester" matches City and United)
    return {
      matchType: 'AMBIGUOUS_MATCH',
      candidateTeams
    };
  },

  /**
   * Returns list of popular teams currently active in tenant catalog.
   */
  async getPopularActiveTeams(organizationId: string, limit = 5): Promise<string[]> {
    const active = await prisma.jersey.findMany({
      where: {
        organizationId,
        isActive: true,
        team: { in: POPULAR_CLUBS }
      },
      select: { team: true },
      distinct: ['team'],
      take: limit
    });

    const found = active.map((a) => a.team);
    if (found.length > 0) return found;

    // Fallback: any active teams
    const anyActive = await prisma.jersey.findMany({
      where: { organizationId, isActive: true },
      select: { team: true },
      distinct: ['team'],
      take: limit
    });
    return anyActive.map((a) => a.team);
  }
};
