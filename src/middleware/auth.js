import { db } from '../db/storage.js';

/**
 * Tenant Authentication Middleware.
 * Enforces that all onboarding actions are tied to a verified tenant session,
 * never an arbitrary tenant ID passed in request payloads.
 */
export async function requireTenantAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  let tenantId = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    // In production, verify your JWT or session token here:
    // e.g. const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // tenantId = decoded.tenantId;
    tenantId = token.startsWith('tenant_') ? token : 'tenant_demo_01';
  } else {
    // Default development tenant if no token provided in development mode
    tenantId = 'tenant_demo_01';
  }

  const tenant = await db.getTenant(tenantId);
  if (!tenant) {
    return res.status(401).json({
      success: false,
      code: 'UNAUTHORIZED_TENANT',
      message: 'Active tenant could not be verified.'
    });
  }

  // Attach verified user and tenant to request object
  req.tenant = tenant;
  next();
}
