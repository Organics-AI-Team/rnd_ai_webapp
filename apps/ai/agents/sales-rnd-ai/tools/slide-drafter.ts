/**
 * Slide Content Drafter Tool
 * Generates structured content for individual presentation slides
 */

export type SlideType =
  | 'title'
  | 'problem'
  | 'solution'
  | 'science'
  | 'benefits'
  | 'data'
  | 'comparison'
  | 'testimonial'
  | 'pricing'
  | 'timeline'
  | 'cta'
  | 'generic';

export interface SlideInputs {
  slide_type: SlideType;
  topic: string;
  key_points: string[];
  target_audience?: 'technical' | 'business' | 'mixed';
  max_bullets?: number;
  include_visual_direction?: boolean;
  data_to_visualize?: {
    type: 'bar' | 'line' | 'pie' | 'comparison';
    values: Array<{ label: string; value: number }>;
  };
}

export interface SlideOutput {
  slide_number?: number;
  headline: string;
  subheadline?: string;
  bullets: string[];
  visual_direction?: string;
  speaker_notes: string;
  estimated_duration: string;
}

/**
 * Draft content for a single presentation slide
 *
 * @param inputs - Slide specifications and content
 * @returns Structured slide content ready for presentation software
 */
export async function draftSlide(inputs: SlideInputs): Promise<SlideOutput> {
  console.log('📄 [slide-drafter] Drafting slide', { type: inputs.slide_type, topic: inputs.topic });

  const {
    slide_type,
    topic,
    key_points,
    target_audience = 'mixed',
    max_bullets = 5,
    include_visual_direction = true,
    data_to_visualize
  } = inputs;

  // Generate headline based on slide type
  const headline = generateHeadline(slide_type, topic, target_audience);

  // Format bullets (limit to max_bullets)
  const bullets = formatBullets(key_points, max_bullets, slide_type);

  // Generate visual direction
  const visual_direction = include_visual_direction
    ? generateVisualDirection(slide_type, topic, data_to_visualize)
    : undefined;

  // Create speaker notes
  const speaker_notes = generateSpeakerNotes(slide_type, topic, bullets);

  // Estimate presentation duration
  const estimated_duration = estimateDuration(slide_type, bullets.length);

  console.log('✅ [slide-drafter] Slide drafted successfully');

  return {
    headline,
    bullets,
    visual_direction,
    speaker_notes,
    estimated_duration
  };
}

/**
 * Generate compelling headline based on slide type and topic
 */
function generateHeadline(type: SlideType, topic: string, audience: string): string {
  const templates: Record<SlideType, (topic: string) => string> = {
    title: (t) => `${t}: The Future of ${extractCategory(t)}`,
    problem: (t) => `The ${t} Challenge Facing the Industry`,
    solution: (t) => `Introducing ${t}: A Better Way Forward`,
    science: (t) => `The Science Behind ${t}`,
    benefits: (t) => `Why ${t} Delivers Real Results`,
    data: (t) => `${t}: By the Numbers`,
    comparison: (t) => `${t} vs. Traditional Solutions`,
    testimonial: (t) => `Real Results with ${t}`,
    pricing: (t) => `${t}: Exceptional Value`,
    timeline: (t) => `Your ${t} Journey Starts Here`,
    cta: (t) => `Ready to Experience ${t}?`,
    generic: (t) => t
  };

  return templates[type](topic);
}

/**
 * Format bullet points with appropriate prefix and structure
 */
function formatBullets(points: string[], max: number, type: SlideType): string[] {
  const formatted = points.slice(0, max).map(point => {
    // Add value suffix if not present
    if (!point.includes('→') && !point.includes('=')) {
      return `${point} → Clear competitive advantage`;
    }
    return point;
  });

  return formatted;
}

/**
 * Generate visual direction for designers
 */
function generateVisualDirection(
  type: SlideType,
  topic: string,
  data?: SlideInputs['data_to_visualize']
): string {
  if (data) {
    const chartDescriptions = {
      bar: 'Vertical bar chart showing comparative values',
      line: 'Line graph demonstrating trend over time',
      pie: 'Pie chart illustrating distribution',
      comparison: 'Side-by-side comparison chart'
    };
    return `${chartDescriptions[data.type]} with data: ${data.values.map(v => `${v.label}: ${v.value}`).join(', ')}`;
  }

  const visualTemplates: Record<SlideType, string> = {
    title: `Hero image of ${topic} product with soft gradient background. Clean, premium aesthetic.`,
    problem: `Split-screen image: Left side showing current pain point, right side showing desired state. Muted colors on problem side.`,
    solution: `Product shot with soft lighting. Highlight key features with subtle callouts. Bright, optimistic color palette.`,
    science: `Molecular structure or ingredient visualization. Clean diagram showing mechanism of action. Use blues and greens for trust.`,
    benefits: `Before/after comparison imagery or icons representing each benefit. Use checkmarks and positive color accents.`,
    data: `Clean data visualization matching the data type. Minimal decoration, focus on clarity. Brand color accents.`,
    comparison: `Table or side-by-side comparison. Highlight advantages in brand color. Keep competitive products neutral.`,
    testimonial: `Customer quote with professional photo. Include company logo if B2B. Warm, trustworthy imagery.`,
    pricing: `Tiered pricing table or value proposition visual. Use hierarchy to guide eye to recommended option.`,
    timeline: `Horizontal timeline with milestone markers. Use progression of colors to show journey. Include icons for each phase.`,
    cta: `Clear, prominent button or action visual. Minimal distraction. High contrast for emphasis. Include contact information.`,
    generic: `Relevant imagery supporting the topic. Clean layout with ample white space.`
  };

  return visualTemplates[type];
}

/**
 * Generate speaker notes for the presenter
 */
function generateSpeakerNotes(type: SlideType, topic: string, bullets: string[]): string {
  const intro = `When presenting this ${type} slide, start by ${getIntroTip(type)}.`;
  const body = `Emphasize these key points: ${bullets.slice(0, 2).join('; ')}.`;
  const closing = `Transition to the next slide by ${getTransitionTip(type)}.`;

  return `${intro} ${body} ${closing}`;
}

/**
 * Get introduction tip based on slide type
 */
function getIntroTip(type: SlideType): string {
  const tips: Record<SlideType, string> = {
    title: 'establishing credibility and setting expectations',
    problem: 'asking a rhetorical question to engage the audience',
    solution: 'highlighting the unique value proposition',
    science: 'bridging from benefits to mechanism',
    benefits: 'using a customer success story',
    data: 'pointing out the most striking statistic',
    comparison: 'acknowledging competitive alternatives fairly',
    testimonial: 'introducing the client and their initial challenge',
    pricing: 'framing cost as an investment in outcomes',
    timeline: 'creating urgency with availability or deadlines',
    cta: 'recapping the core value and asking for commitment',
    generic: 'connecting to the previous slide\'s conclusion'
  };
  return tips[type];
}

/**
 * Get transition tip to next slide
 */
function getTransitionTip(type: SlideType): string {
  const tips: Record<SlideType, string> = {
    title: 'asking "Why does this matter?" to lead into the problem',
    problem: 'saying "But what if there was a better way?"',
    solution: 'asking "How does this work?"',
    science: 'asking "What does this mean for you?"',
    benefits: 'saying "Let me show you the data behind these claims"',
    data: 'asking "How does this compare to alternatives?"',
    comparison: 'saying "Don\'t just take our word for it"',
    testimonial: 'asking "What would this look like for your business?"',
    pricing: 'saying "Let me show you the timeline to get started"',
    timeline: 'asking "Are you ready to begin?"',
    cta: 'thanking them and opening for questions',
    generic: 'summarizing the key takeaway'
  };
  return tips[type];
}

/**
 * Estimate slide presentation duration
 */
function estimateDuration(type: SlideType, bulletCount: number): string {
  const baseSeconds = {
    title: 30,
    problem: 60,
    solution: 60,
    science: 120,
    benefits: 90,
    data: 75,
    comparison: 90,
    testimonial: 60,
    pricing: 90,
    timeline: 45,
    cta: 30,
    generic: 60
  };

  const additionalPerBullet = 10; // seconds per bullet point
  const totalSeconds = baseSeconds[type] + (bulletCount * additionalPerBullet);

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Extract category from topic (simple heuristic)
 */
function extractCategory(topic: string): string {
  const categories = ['serum', 'cream', 'cleanser', 'sunscreen', 'toner', 'mask'];
  const found = categories.find(cat => topic.toLowerCase().includes(cat));
  return found || 'skincare';
}

/**
 * Tool schema for AI agent
 */
export const slideDrafterTool = {
  name: 'draft_slide_content',
  description: 'Generate structured content for a single presentation slide with headline, bullets, and visual direction',
  parameters: {
    type: 'object',
    properties: {
      slide_type: {
        type: 'string',
        enum: ['title', 'problem', 'solution', 'science', 'benefits', 'data', 'comparison', 'testimonial', 'pricing', 'timeline', 'cta', 'generic'],
        description: 'Type of slide to generate'
      },
      topic: {
        type: 'string',
        description: 'Main topic or focus of the slide'
      },
      key_points: {
        type: 'array',
        items: { type: 'string' },
        description: 'Key points to include in the slide (will be formatted as bullets)'
      },
      target_audience: {
        type: 'string',
        enum: ['technical', 'business', 'mixed'],
        description: 'Target audience expertise level',
        default: 'mixed'
      },
      max_bullets: {
        type: 'number',
        description: 'Maximum number of bullet points (default: 5)',
        default: 5
      },
      include_visual_direction: {
        type: 'boolean',
        description: 'Whether to include visual design direction',
        default: true
      },
      data_to_visualize: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['bar', 'line', 'pie', 'comparison']
          },
          values: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'number' }
              }
            }
          }
        },
        description: 'Optional data to visualize in chart format'
      }
    },
    required: ['slide_type', 'topic', 'key_points']
  }
};
