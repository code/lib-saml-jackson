import * as Retraced from '@retracedhq/retraced';
import type { Event } from '@retracedhq/retraced';
import type { NextApiRequest } from 'next';
import { getToken as getNextAuthToken } from 'next-auth/jwt';
import requestIp from 'request-ip';

import jackson from '@lib/jackson';
import { retracedOptions } from '@lib/env';
import { sessionName } from '@lib/constants';

type AuditEventType =
  | 'sso.user.login'

  // Single Sign On
  | 'sso.connection.create'
  | 'sso.connection.update'
  | 'sso.connection.delete'

  // Directory Sync
  | 'dsync.connection.create'
  | 'dsync.connection.update'
  | 'dsync.connection.delete'
  | 'dsync.webhook_event.delete'

  // Setup Link
  | 'sso.setuplink.create'
  | 'sso.setuplink.update'
  | 'sso.setuplink.delete'
  | 'dsync.setuplink.create'
  | 'dsync.setuplink.update'
  | 'dsync.setuplink.delete'

  // Federated SAML
  | 'federation.app.create'
  | 'federation.app.update'
  | 'federation.app.delete'

  // Retraced
  | 'retraced.project.create'

  // Admin settings
  | 'portal.branding.update'
  | 'portal.user.login';

interface ReportAdminEventParams {
  action: AuditEventType;
  crud: Retraced.CRUD;
  target?: Retraced.Target;
  req?: NextApiRequest;
  actor?: Retraced.Actor;
}

interface ReportEventParams {
  action: AuditEventType;
  crud: Retraced.CRUD;
  actor: Retraced.Actor;
  req: NextApiRequest;
  group?: Retraced.Group;
  target?: Retraced.Target;
  productId?: string;
}

const adminPortalGroup = {
  id: 'boxyhq-admin-portal',
  name: 'BoxyHQ Admin Portal',
};

let client: Retraced.Client | null = null;

// Create a Retraced client
const getClient = async () => {
  const { checkLicense } = await jackson();

  if (!(await checkLicense())) {
    return;
  }

  if (!retracedOptions.hostUrl || !retracedOptions.apiKey || !retracedOptions.projectId) {
    return;
  }

  if (client) {
    return client;
  }

  client = new Retraced.Client({
    endpoint: retracedOptions.hostUrl,
    apiKey: retracedOptions.apiKey,
    projectId: retracedOptions.projectId,
  });

  return client;
};

// Report events to Retraced
const reportEvent = async (params: ReportEventParams) => {
  const { action, crud, actor, req } = params;

  try {
    const retracedClient = await getClient();

    if (!retracedClient) {
      return;
    }

    const retracedEvent: Event = {
      action,
      crud,
      actor,
      created: new Date(),
      source_ip: getClientIp(req),
    };

    if ('group' in params && params.group) {
      retracedEvent.group = params.group;
    }

    if ('target' in params && params.target) {
      retracedEvent.target = params.target;
    }

    // Find team info if productId is provided
    if ('productId' in params && params.productId) {
      const { productController } = await jackson();

      const product = await productController.get(params.productId);

      retracedEvent.group = {
        id: product.teamId,
        name: product.teamName,
      };

      retracedEvent.target = {
        id: product.id,
        name: product.name,
      };
    }

    console.log(retracedEvent);

    await retracedClient.reportEvent(retracedEvent);
  } catch (error: any) {
    console.error('Error reporting event to Retraced', error);
  }
};

// Report Admin portal events to Retraced
export const reportAdminPortalEvent = async (params: ReportAdminEventParams) => {
  const { action, crud, target, actor, req } = params;

  try {
    const retracedClient = await getClient();

    if (!retracedClient) {
      return;
    }

    const retracedEvent: Event = {
      action,
      crud,
      target,
      actor: actor ?? (await getAdminUser(req)),
      group: adminPortalGroup,
      created: new Date(),
      source_ip: getClientIp(req),
    };

    await retracedClient.reportEvent(retracedEvent);
  } catch (error: any) {
    console.error('Error reporting event to Retraced', error);
  }
};

// Find admin actor info from NextAuth token
const getAdminUser = async (req: NextApiRequest | undefined) => {
  if (!req) {
    throw new Error(`NextApiRequest is required to get actor info for Retraced event.`);
  }

  const user = await getNextAuthToken({
    req,
    cookieName: sessionName,
  });

  if (!user || !user.email || !user.name) {
    throw new Error(`Can't find actor info from the NextAuth token.`);
  }

  return {
    id: user.email,
    name: user.name,
  };
};

// Find Ip from request
const getClientIp = (req: NextApiRequest | undefined) => {
  if (!req) {
    return undefined;
  }

  const sourceIp = requestIp.getClientIp(req);

  // TODO: Verify this is the correct way to check
  if (!sourceIp.startsWith('::')) {
    return sourceIp as string;
  }

  return undefined;
};

const retraced = {
  reportEvent,
  reportAdminPortalEvent,
};

export default retraced;
