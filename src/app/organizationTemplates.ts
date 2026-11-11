import type { Floor, PageSetup, TitleBlock } from '../model/types';

const STORAGE_KEY = 'evac-organization-templates';
type TemplateTitle = Pick<TitleBlock, 'title' | 'organization' | 'author' | 'instructions' | 'emergencyNumbers' | 'logo'>;
type TemplatePage = Omit<PageSetup, 'area' | 'customArea' | 'scale' | 'scaleMode' | 'northAngle'>;

export interface OrganizationTemplate {
  name: string;
  title: TemplateTitle;
  page: TemplatePage;
}

export function organizationTemplates(): OrganizationTemplate[] {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export function writeOrganizationTemplates(templates: OrganizationTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function templateFromFloor(name: string, floor: Floor): OrganizationTemplate {
  const { title, organization, author, instructions, emergencyNumbers, logo } = floor.titleBlock;
  const { area, customArea, scale, scaleMode, northAngle, ...page } = floor.page;
  return { name, title: { title, organization, author, instructions, emergencyNumbers, logo }, page };
}

export function applyOrganizationTemplate(floor: Floor, template: OrganizationTemplate): boolean {
  const contentChanged = floor.titleBlock.instructions !== template.title.instructions
    || floor.titleBlock.emergencyNumbers !== template.title.emergencyNumbers;
  Object.assign(floor.titleBlock, template.title);
  Object.assign(floor.page, template.page, { frames: template.page.frames ? { ...template.page.frames } : undefined });
  if (contentChanged && floor.titleBlock.status === 'validated') {
    Object.assign(floor.titleBlock, { status: 'to_validate', validatedBy: '', validatedAt: '',
      validationReason: 'Consignes ou numéros d’urgence modifiés par un modèle' });
    return true;
  }
  return false;
}
