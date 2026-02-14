/**
 * Parse PROJECT.md files to extract potential tasks
 */

export interface ParsedProject {
  title: string;
  description: string;
  suggestedTasks: {
    title: string;
    description: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
  }[];
}

/**
 * Extract title from markdown content (first H1 heading)
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Untitled Project';
}

/**
 * Extract description from markdown (text after title until first section)
 */
function extractDescription(content: string): string {
  const lines = content.split('\n');
  let inDescription = false;
  const descLines: string[] = [];
  
  for (const line of lines) {
    // Skip the title
    if (line.startsWith('#') && !inDescription) {
      inDescription = true;
      continue;
    }
    
    // Stop at next heading
    if (inDescription && line.match(/^##\s+/)) {
      break;
    }
    
    if (inDescription && line.trim()) {
      descLines.push(line);
    }
  }
  
  return descLines
    .join('\n')
    .trim()
    .substring(0, 500); // Limit to 500 chars
}

/**
 * Parse priority from text
 */
function extractPriority(text: string): 'P0' | 'P1' | 'P2' | 'P3' {
  const lowerText = text.toLowerCase();
  
  // P0 indicators: critical, must have, p0, blocker, urgent
  if (
    lowerText.includes('(p0)') ||
    lowerText.includes('[p0]') ||
    lowerText.includes('critical') ||
    lowerText.includes('blocker') ||
    lowerText.includes('urgent')
  ) {
    return 'P0';
  }
  
  // P1 indicators: high priority, p1, important, must do
  if (
    lowerText.includes('(p1)') ||
    lowerText.includes('[p1]') ||
    lowerText.includes('high priority') ||
    lowerText.includes('important') ||
    lowerText.includes('must do')
  ) {
    return 'P1';
  }
  
  // P3 indicators: low priority, p3, nice to have, optional
  if (
    lowerText.includes('(p3)') ||
    lowerText.includes('[p3]') ||
    lowerText.includes('low priority') ||
    lowerText.includes('nice to have') ||
    lowerText.includes('optional')
  ) {
    return 'P3';
  }
  
  // Default to P2
  return 'P2';
}

/**
 * Extract bullet points from a section
 */
function extractBulletPoints(content: string): string[] {
  const lines = content.split('\n');
  const bullets: string[] = [];
  
  for (const line of lines) {
    // Match various bullet point formats: -, *, +, or numbered [x]
    const match = line.match(/^\s*[-*+]\s+(.+)$/) || line.match(/^\s*\[\s*[xX\-]\s*\]\s+(.+)$/);
    if (match) {
      const text = match[1].trim();
      // Filter out empty lines and markdown formatting
      if (text && !text.startsWith('#')) {
        bullets.push(text);
      }
    }
  }
  
  return bullets;
}

/**
 * Parse PROJECT.md content and extract suggested tasks
 */
export function parseProjectMd(content: string): ParsedProject {
  const title = extractTitle(content);
  const description = extractDescription(content);
  const suggestedTasks: ParsedProject['suggestedTasks'] = [];
  
  // Section keywords to look for
  const sectionKeywords = [
    'tasks',
    'requirements',
    'deliverables',
    'goals',
    'features',
    'todo',
    'work items',
  ];
  
  // Split by sections
  const sections = content.split(/^##\s+/m);
  
  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const sectionTitle = lines[0] ? lines[0].trim() : '';
    const sectionContent = lines.slice(1).join('\n');
    
    // Check if this section matches our keywords
    const isRelevantSection = sectionKeywords.some(kw =>
      sectionTitle.toLowerCase().includes(kw)
    );
    
    if (!isRelevantSection) {
      continue;
    }
    
    // Extract bullet points from this section
    const bullets = extractBulletPoints(sectionContent);
    
    for (const bullet of bullets) {
      // Skip if it looks like a checkbox item (often less detailed)
      if (bullet.startsWith('[') || bullet.startsWith('(')) {
        continue;
      }
      
      // Extract priority from the bullet text
      const priority = extractPriority(bullet);
      
      // Clean up the text - remove priority indicators
      let cleanTitle = bullet
        .replace(/\(p[0-3]\)/gi, '')
        .replace(/\[p[0-3]\]/gi, '')
        .replace(/\[(high|low|medium) priority\]/gi, '')
        .replace(/\(high|low|medium priority\)/gi, '')
        .replace(/\bcritical\b/gi, '')
        .replace(/\bblocker\b/gi, '')
        .replace(/\boptional\b/gi, '')
        .trim();
      
      // Only add if we have a meaningful title
      if (cleanTitle.length > 3) {
        suggestedTasks.push({
          title: cleanTitle,
          description: '', // Description can be added later
          priority,
        });
      }
    }
  }
  
  // Remove duplicates (case-insensitive)
  const seen = new Set<string>();
  const uniqueTasks = suggestedTasks.filter(task => {
    const key = task.title.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  return {
    title,
    description,
    suggestedTasks: uniqueTasks,
  };
}
