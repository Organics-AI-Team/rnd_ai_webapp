'use client';

import { Calculator, FlaskConical, Globe2, PackageSearch, TrendingUp, type LucideIcon } from 'lucide-react';

/** A focused capability the unified R&D agent can execute. */
export type AgentSkillId = 'materials' | 'formulation' | 'costing' | 'market' | 'sales';

export interface AgentSkill {
  id: AgentSkillId;
  label: string;
  description: string;
  prompt: string;
  placeholder: string;
  suggestions: string[];
  icon: LucideIcon;
}

/** All task focuses use the same chat thread and unified R&D agent. */
export const AGENT_SKILLS: readonly AgentSkill[] = [
  {
    id: 'materials',
    label: 'Materials & stock',
    description: 'ค้นหาวัตถุดิบ ตรวจสต็อก และเปรียบเทียบตัวเลือก',
    prompt: 'ค้นหาวัตถุดิบที่เหมาะกับ',
    placeholder: 'ค้นหาวัตถุดิบ ตรวจสต็อก หรือเปรียบเทียบตัวเลือก...',
    suggestions: [
      'ค้นหาวัตถุดิบเพิ่มความชุ่มชื้น',
      'ตรวจสต็อก niacinamide',
      'เปรียบเทียบสาร active สำหรับลดริ้วรอย',
    ],
    icon: PackageSearch,
  },
  {
    id: 'formulation',
    label: 'Formula design',
    description: 'ออกแบบ ปรับ และตรวจสอบสูตรเครื่องสำอาง',
    prompt: 'ช่วยออกแบบสูตร',
    placeholder: 'บอกประเภทผลิตภัณฑ์ benefit และข้อจำกัดของสูตร...',
    suggestions: [
      'ออกแบบสูตร anti-aging serum',
      'ปรับสูตรให้เนื้อเบาและซึมง่าย',
      'หาสูตรอ้างอิงสำหรับกันแดด',
    ],
    icon: FlaskConical,
  },
  {
    id: 'costing',
    label: 'Cost & scale',
    description: 'คำนวณต้นทุน แปลงหน่วย และขยายขนาดการผลิต',
    prompt: 'ช่วยคำนวณต้นทุนและ scale สูตร',
    placeholder: 'ระบุสูตรหรือ batch ที่ต้องการคำนวณ...',
    suggestions: [
      'คำนวณต้นทุนและ scale สูตรเป็น 100 kg',
      'แปลงสูตร 500 g เป็น 20 kg',
      'หาวิธีลดต้นทุนสูตรโดยคง benefit หลัก',
    ],
    icon: Calculator,
  },
  {
    id: 'market',
    label: 'Market research',
    description: 'วิเคราะห์เทรนด์ คู่แข่ง และโอกาสทางการตลาด',
    prompt: 'ช่วยวิเคราะห์เทรนด์ตลาด',
    placeholder: 'ถามเรื่องเทรนด์ กลุ่มลูกค้า หรือคู่แข่ง...',
    suggestions: [
      'วิเคราะห์เทรนด์ตลาดกันแดด',
      'กลุ่มลูกค้าสำหรับ serum ผิวแพ้ง่ายคือใคร',
      'เปรียบเทียบ positioning ของคู่แข่ง',
    ],
    icon: Globe2,
  },
  {
    id: 'sales',
    label: 'Sales planning',
    description: 'แปลงข้อได้เปรียบของสินค้าเป็นแผนขาย B2B',
    prompt: 'ช่วยวางแผนการขายสำหรับ',
    placeholder: 'บอกลูกค้าเป้าหมาย สินค้า หรือเป้าหมายการขาย...',
    suggestions: [
      'วางแผนการขาย B2B สำหรับวัตถุดิบ',
      'สร้าง pitch สำหรับ active ลดริ้วรอย',
      'ช่วยเตรียมคำถาม discovery สำหรับลูกค้า',
    ],
    icon: TrendingUp,
  },
];

interface AIAgentSkillsProps {
  active_skill_id: AgentSkillId;
  on_select: (skill: AgentSkill) => void;
}

/**
 * Show a task-focus toggle for the one unified ReAct agent. It changes the
 * editable starter prompt and examples; it never switches chat backends.
 */
export function AIAgentSkills({ active_skill_id, on_select }: AIAgentSkillsProps) {
  return (
    <div className="flex-shrink-0 border-b border-emerald-100/80 bg-white/70 px-3 py-2.5">
      <div className="mx-auto flex max-w-2xl items-center gap-2 overflow-x-auto pb-0.5" aria-label="R&D AI task focus">
        <span className="hidden whitespace-nowrap text-[10px] font-medium uppercase tracking-wider text-emerald-800/45 sm:inline">
          Focus
        </span>
        {AGENT_SKILLS.map((skill) => {
          const Icon = skill.icon;
          const is_active = skill.id === active_skill_id;
          return (
            <button
              key={skill.id}
              type="button"
              onClick={() => on_select(skill)}
              aria-pressed={is_active}
              title={skill.description}
              className={[
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1',
                is_active
                  ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                  : 'border-emerald-100 bg-white text-emerald-800 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-950',
              ].join(' ')}
            >
              <Icon size={13} className={is_active ? 'text-white' : 'text-emerald-600'} />
              {skill.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
