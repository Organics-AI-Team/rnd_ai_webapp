/**
 * Follow-up Email Generator Tool
 * Creates professional follow-up messages after client meetings
 */

export interface FollowUpInputs {
  meeting_summary: string;
  client_name: string;
  key_discussion_points: string[];
  next_steps: string[];
  tone?: 'professional' | 'friendly' | 'formal';
  urgency?: 'low' | 'medium' | 'high';
  include_attachments?: string[];
}

export interface FollowUpOutput {
  subject: string;
  body: string;
  suggested_send_time: string;
  follow_up_date: string;
}

/**
 * Generate a follow-up email after a sales meeting
 *
 * @param inputs - Meeting details and context
 * @returns Formatted email draft with subject and body
 */
export async function generateFollowUp(inputs: FollowUpInputs): Promise<FollowUpOutput> {
  console.log('📧 [follow-up-generator] Generating follow-up email', { client: inputs.client_name });

  const {
    meeting_summary,
    client_name,
    key_discussion_points,
    next_steps,
    tone = 'professional',
    urgency = 'medium',
    include_attachments = []
  } = inputs;

  // Subject line templates based on urgency
  const subjectTemplates = {
    low: `Following up - ${client_name} Meeting Recap`,
    medium: `Next Steps: ${client_name} Product Discussion`,
    high: `Action Required: ${client_name} - Time-Sensitive Opportunity`
  };

  const subject = subjectTemplates[urgency];

  // Greeting based on tone
  const greetings = {
    professional: `Dear ${client_name} Team,`,
    friendly: `Hi ${client_name} Team!`,
    formal: `Dear Valued Partners at ${client_name},`
  };

  const closings = {
    professional: 'Best regards',
    friendly: 'Looking forward to hearing from you!',
    formal: 'Respectfully yours'
  };

  // Build email body
  const body = `${greetings[tone]}

Thank you for taking the time to meet with us ${getTodayFormatted()}. It was great discussing your product development needs and how we can support your goals.

**Meeting Recap:**
${meeting_summary}

**Key Discussion Points:**
${key_discussion_points.map((point, idx) => `${idx + 1}. ${point}`).join('\n')}

**Proposed Next Steps:**
${next_steps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

${include_attachments.length > 0 ? `**Attached Documents:**\n${include_attachments.map((doc, idx) => `${idx + 1}. ${doc}`).join('\n')}\n\n` : ''}
I'm excited to move forward with this partnership opportunity. Please let me know if you have any questions or need additional information.

Would you be available for a follow-up call next week to discuss the proposal in more detail?

${closings[tone]},

---
**Maya Siriporn**
Senior Sales & Product Development Lead
📱 +66-XX-XXX-XXXX
📧 maya@company.com
`;

  // Calculate suggested send time and follow-up date
  const suggested_send_time = urgency === 'high'
    ? 'Within 2 hours'
    : urgency === 'medium'
    ? 'Within 24 hours'
    : 'Within 48 hours';

  const follow_up_date = urgency === 'high'
    ? '3 days from send'
    : urgency === 'medium'
    ? '5 days from send'
    : '7 days from send';

  console.log('✅ [follow-up-generator] Email generated successfully');

  return {
    subject,
    body,
    suggested_send_time,
    follow_up_date
  };
}

/**
 * Get today's date in a friendly format
 */
function getTodayFormatted(): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };
  return new Date().toLocaleDateString('en-US', options);
}

/**
 * Tool schema for AI agent
 */
export const followUpGeneratorTool = {
  name: 'generate_followup',
  description: 'Generate a professional follow-up email after a client meeting with action items and next steps',
  parameters: {
    type: 'object',
    properties: {
      meeting_summary: {
        type: 'string',
        description: 'Brief summary of the meeting (2-3 sentences)'
      },
      client_name: {
        type: 'string',
        description: 'Name of the client/company'
      },
      key_discussion_points: {
        type: 'array',
        items: { type: 'string' },
        description: 'Main topics discussed during the meeting'
      },
      next_steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Action items and next steps agreed upon'
      },
      tone: {
        type: 'string',
        enum: ['professional', 'friendly', 'formal'],
        description: 'Tone of the email',
        default: 'professional'
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Urgency level affecting send timing',
        default: 'medium'
      },
      include_attachments: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of document names to reference as attached'
      }
    },
    required: ['meeting_summary', 'client_name', 'key_discussion_points', 'next_steps']
  }
};
