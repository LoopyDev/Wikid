import { DatabaseFieldType, Prisma } from '@prisma/client';

type TemplateField = {
  name: string;
  type: DatabaseFieldType;
  options?: Prisma.JsonValue | null;
};

export const INVENTORY_TEMPLATE_FIELDS: TemplateField[] = [
  { name: 'Item Name', type: DatabaseFieldType.TEXT, options: { source: 'page' } },
  { name: 'Asset Tag', type: DatabaseFieldType.TEXT, options: { source: 'assetTag', readonly: true } },
  { name: 'SKU', type: DatabaseFieldType.TEXT },
  { name: 'Category', type: DatabaseFieldType.SELECT, options: { choices: ['Raw Materials', 'Components', 'Finished Goods', 'Consumables', 'Tools'] } },
  { name: 'Location', type: DatabaseFieldType.TEXT },
  { name: 'Quantity On Hand', type: DatabaseFieldType.NUMBER },
  { name: 'Unit', type: DatabaseFieldType.SELECT, options: { choices: ['ea', 'box', 'kg', 'L', 'm'] } },
  { name: 'Reorder Point', type: DatabaseFieldType.NUMBER },
  { name: 'Supplier', type: DatabaseFieldType.TEXT },
  { name: 'Lot/Batch', type: DatabaseFieldType.TEXT },
  { name: 'Serial Number', type: DatabaseFieldType.TEXT },
  { name: 'Expiry Date', type: DatabaseFieldType.DATE },
  { name: 'Status', type: DatabaseFieldType.SELECT, options: { choices: ['In Stock', 'Low', 'Out', 'Reserved', 'Discontinued'] } },
  { name: 'Notes', type: DatabaseFieldType.TEXT },
];

export const MAINTENANCE_TEMPLATE_FIELDS: TemplateField[] = [
  { name: 'Maintenance Summary', type: DatabaseFieldType.TEXT, options: { source: 'page' } },
  { name: 'Item', type: DatabaseFieldType.TEXT },
  { name: 'Event Type', type: DatabaseFieldType.SELECT, options: { choices: ['Inspection', 'Repair', 'Cleaning', 'Calibration', 'Upgrade', 'Other'] } },
  { name: 'Scheduled Date', type: DatabaseFieldType.DATE },
  { name: 'Completed Date', type: DatabaseFieldType.DATE },
  { name: 'Status', type: DatabaseFieldType.SELECT, options: { choices: ['Planned', 'In Progress', 'Completed', 'Cancelled'] } },
  { name: 'Performed By', type: DatabaseFieldType.TEXT },
  { name: 'Vendor', type: DatabaseFieldType.TEXT },
  { name: 'Cost', type: DatabaseFieldType.NUMBER },
  { name: 'Downtime (hrs)', type: DatabaseFieldType.NUMBER },
  { name: 'Findings', type: DatabaseFieldType.TEXT },
  { name: 'Actions Taken', type: DatabaseFieldType.TEXT },
  { name: 'Parts Used', type: DatabaseFieldType.TEXT },
  { name: 'Notes', type: DatabaseFieldType.TEXT },
];

export const ASSIGNMENTS_TEMPLATE_FIELDS: TemplateField[] = [
  { name: 'Assignment Summary', type: DatabaseFieldType.TEXT, options: { source: 'page' } },
  { name: 'Asset', type: DatabaseFieldType.TEXT },
  { name: 'Status', type: DatabaseFieldType.SELECT, options: { choices: ['Open', 'In Progress', 'Blocked', 'Completed', 'Cancelled'] } },
  { name: 'Priority', type: DatabaseFieldType.SELECT, options: { choices: ['Low', 'Medium', 'High', 'Urgent'] } },
  { name: 'Task Type', type: DatabaseFieldType.SELECT, options: { choices: ['Inspection', 'Repair', 'Cleaning', 'Calibration', 'Move', 'Other'] } },
  { name: 'Assigned To', type: DatabaseFieldType.TEXT },
  { name: 'Requested By', type: DatabaseFieldType.TEXT },
  { name: 'Requested Date', type: DatabaseFieldType.DATE },
  { name: 'Due Date', type: DatabaseFieldType.DATE },
  { name: 'Completed Date', type: DatabaseFieldType.DATE },
  { name: 'Estimated Hours', type: DatabaseFieldType.NUMBER },
  { name: 'Actual Hours', type: DatabaseFieldType.NUMBER },
  { name: 'Work Order Ref', type: DatabaseFieldType.TEXT },
  { name: 'Notes', type: DatabaseFieldType.TEXT },
];
