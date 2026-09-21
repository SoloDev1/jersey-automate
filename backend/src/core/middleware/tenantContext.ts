import { Request, Response, NextFunction } from 'express';

const DEFAULT_ORGANIZATION_ID = 'org_default';
const TENANT_ID_REGEX = /^[a-zA-Z0-9_-]{1,50}$/;

/**
 * Injects the tenant organization ID into the Express request context.
 * Strictly validates format to prevent tenant injection and directory traversal.
 * Restricts query-parameter override to non-production environments.
 */
export function tenantContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerOrgId = req.headers['x-organization-id'];
  const queryOrgId = process.env.NODE_ENV !== 'production' ? req.query.organization_id : undefined;

  const candidate = (
    typeof headerOrgId === 'string' ? headerOrgId :
    typeof queryOrgId === 'string' ? queryOrgId : ''
  ).trim();

  if (candidate && TENANT_ID_REGEX.test(candidate)) {
    req.organizationId = candidate;
  } else {
    req.organizationId = DEFAULT_ORGANIZATION_ID;
  }

  next();
}

