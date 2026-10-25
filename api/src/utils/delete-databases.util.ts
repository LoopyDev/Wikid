import { Prisma } from '@prisma/client';

type DatabaseClient = Pick<
  Prisma.TransactionClient,
  'database' | 'databaseRow' | 'databaseField' | 'databaseForm' | 'databaseView'
>;

/**
 * Deletes databases together with their rows, fields, forms and views, which all point at the
 * database and would otherwise block the delete. Pass `databaseIds` to delete only those
 * databases, or leave it out to delete every database.
 */
export async function deleteDatabasesWithContents(client: DatabaseClient, databaseIds?: string[]) {
  if (databaseIds && !databaseIds.length) {
    return { rows: 0, fields: 0, forms: 0, views: 0, databases: 0 };
  }
  const children = databaseIds ? { databaseId: { in: databaseIds } } : {};
  const rows = await client.databaseRow.deleteMany({ where: children });
  const fields = await client.databaseField.deleteMany({ where: children });
  const forms = await client.databaseForm.deleteMany({ where: children });
  const views = await client.databaseView.deleteMany({ where: children });
  const databases = await client.database.deleteMany({ where: databaseIds ? { id: { in: databaseIds } } : {} });
  return { rows: rows.count, fields: fields.count, forms: forms.count, views: views.count, databases: databases.count };
}
