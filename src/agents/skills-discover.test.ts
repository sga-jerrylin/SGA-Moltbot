import { describe, expect, test } from "vitest";

import { rankSkillPoolIndex, scoreSkillMatch } from "./skills-discover.js";

describe("skills-discover", () => {
  test("scoreSkillMatch returns higher score for better match", () => {
    const good = scoreSkillMatch({
      prompt: "organize my invoices and receipts",
      name: "invoice-organizer",
      description: "Automatically organize invoices and receipts",
      keywords: ["invoice", "receipt", "organize"],
    });
    const bad = scoreSkillMatch({
      prompt: "organize my invoices and receipts",
      name: "git-pushing",
      description: "Helps you push git branches safely",
      keywords: ["git", "push"],
    });
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeGreaterThanOrEqual(0);
    expect(good).toBeLessThanOrEqual(1);
  });

  test("rankSkillPoolIndex prefers the best matching skill", () => {
    const index = {
      skills: [
        {
          name: "git-pushing",
          description: "Helps you push git branches safely",
          url: "https://github.com/ComposioHQ/awesome-claude-skills/tree/master/git-pushing",
          keywords: ["git", "push"],
        },
        {
          name: "invoice-organizer",
          description: "Automatically organize invoices and receipts",
          url: "https://github.com/ComposioHQ/awesome-claude-skills/tree/master/invoice-organizer",
          keywords: ["invoice", "receipt", "organize"],
        },
      ],
    };

    const ranked = rankSkillPoolIndex({
      prompt: "I need to organize receipts",
      index,
      limit: 5,
      threshold: 0.0,
    });

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.skillName).toBe("invoice-organizer");
    expect(ranked[0]?.provider).toBe("skill-pool");
  });
});

