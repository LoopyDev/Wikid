# Maintenance System Template (Compliant)

This template assumes a compliant Inventory database and a separate Maintenance database that logs one record per maintenance event. The Maintenance table links to Inventory via a relation field.

## 1) Inventory database (existing)

Keep Inventory focused on the item itself. Add only summary fields that are useful for quick scanning.

Suggested fields:
- Item Name (Text, title)
- Asset Tag (Text, readonly; generated)
- SKU (Text)
- Category (Select)
- Location (Relation or Text)
- Status (Select)
- Maintenance Status (Select: Up to date, Due soon, Overdue, Out of service)
- Last Service Date (Date)
- Next Service Date (Date)
- Notes (Text)

Optional:
- Maintenance Log (Relation to Maintenance table) for quick navigation.

## 2) Maintenance database (event log)

One record per maintenance action.

Suggested fields:
- Item (Relation to Inventory, required)
- Event Type (Select: Inspection, Repair, Cleaning, Calibration, Upgrade, Other)
- Scheduled Date (Date)
- Completed Date (Date)
- Performed By (Select from members or Text)
- Vendor (Text)
- Cost (Number + Currency label in UI)
- Downtime (Number, hours)
- Findings (Text)
- Actions Taken (Text)
- Parts Used (Text)
- Status (Select: Planned, In Progress, Completed, Cancelled)
- Attachments (Files)
- Notes (Text)

Compliance behavior:
- Each maintenance event is append-only.
- Governance state is handled by the compliant workflow (Draft/Submitted/Review/Closed/Archived).

## 3) Relations

Recommended:
- Maintenance.Item -> Inventory (single relation).

Optional:
- Inventory.Maintenance Log -> Maintenance (multi relation) if you want a direct log view per item.

## 4) Forms (examples)

### A) "Create Maintenance Event" form
- Mode: Create
- Initial status: Submitted
- Required: Item, Event Type, Scheduled Date
- Autofill: Performed By = current user

### B) "Complete Maintenance" form
- Mode: Update
- Filter: Status = In Progress (or Planned)
- Required: Completed Date, Actions Taken
- Transition status: Closed (if workflow allows)

### C) "Schedule Maintenance" form
- Mode: Update
- Filter: Status = Planned
- Required: Scheduled Date

## 5) Conditional rules (examples)

- If Event Type = Repair, require Cost and Vendor.
- If Status = Completed, require Completed Date.
- If Vendor is filled, require Cost.

## 6) Views

Maintenance DB views:
- Upcoming: Status != Completed, Scheduled Date in the next 30 days.
- Overdue: Status != Completed, Scheduled Date in the past.
- Recent: Completed Date in the last 30 days.

Inventory DB views:
- Needs Maintenance: Maintenance Status = Due soon or Overdue.
- Out of Service: Status = Out of service.
