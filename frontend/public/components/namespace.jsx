/* eslint-disable tsdoc/syntax */
import * as _ from 'lodash-es';
import * as React from 'react';
import { DocumentTitle } from '@console/shared/src/components/document-title/DocumentTitle';
import { css } from '@patternfly/react-styles';
import { sortable } from '@patternfly/react-table';
import {
  Alert,
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Tooltip,
  Grid,
  GridItem,
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/js/icons/search-icon';

import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';

import { PencilAltIcon } from '@patternfly/react-icons/dist/esm/icons/pencil-alt-icon';
import { Link } from 'react-router-dom';

import {
  Status,
  getRequester,
  getDescription,
  FLAGS,
  GreenCheckCircleIcon,
  getName,
  COLUMN_MANAGEMENT_CONFIGMAP_KEY,
  COLUMN_MANAGEMENT_LOCAL_STORAGE_KEY,
  LAST_NAMESPACE_NAME_LOCAL_STORAGE_KEY,
  LAST_NAMESPACE_NAME_USER_SETTINGS_KEY,
  useUserSettingsCompatibility,
  isModifiedEvent,
  REQUESTER_FILTER,
  useFlag,
  usePrometheusGate,
} from '@console/shared';
import { ByteDataTypes } from '@console/shared/src/graph-helper/data-utils';
import * as k8sActions from '@console/dynamic-plugin-sdk/src/app/k8s/actions/k8s';
import { useActivePerspective } from '@console/dynamic-plugin-sdk';
import PaneBody from '@console/shared/src/components/layout/PaneBody';
import {
  ConsoleLinkModel,
  NamespaceModel,
  ProjectModel,
  SecretModel,
  ServiceAccountModel,
} from '../models';
import { coFetchJSON } from '../co-fetch';
import { k8sGet, referenceForModel } from '../module/k8s';
import * as UIActions from '../actions/ui';
import { DetailsPage, ListPage, Table, TableData } from './factory';
import { ExternalLink } from '@console/shared/src/components/links/ExternalLink';
import {
  DetailsItem,
  Kebab,
  LabelList,
  LoadingInline,
  ConsoleEmptyState,
  ResourceIcon,
  ResourceKebab,
  ResourceLink,
  ResourceSummary,
  SectionHeading,
  formatBytesAsMiB,
  formatCores,
  humanizeBinaryBytes,
  humanizeCpuCores,
  navFactory,
  useAccessReview,
} from './utils';
import { Timestamp } from '@console/shared/src/components/datetime/Timestamp';
import { deleteNamespaceModal, configureNamespacePullSecretModal } from './modals';
import { RoleBindingsPage } from './RBAC';
import { Bar, Area, PROMETHEUS_BASE_PATH } from './graphs';
import { flagPending } from '../reducers/features';
import { OpenShiftGettingStarted } from './start-guide';
import { OverviewListPage } from './overview';
import {
  getNamespaceDashboardConsoleLinks,
  ProjectDashboard,
} from './dashboard/project-dashboard/project-dashboard';
import { useK8sWatchResource } from '@console/internal/components/utils/k8s-watch-hook';

import {
  isCurrentUser,
  isOtherUser,
  isSystemNamespace,
} from '@console/shared/src/components/namespace';
import { useCreateNamespaceModal } from '@console/shared/src/hooks/useCreateNamespaceModal';
import { useCreateProjectModal } from '@console/shared/src/hooks/useCreateProjectModal';

const getDisplayName = (obj) =>
  _.get(obj, ['metadata', 'annotations', 'openshift.io/display-name']);

// KKD CHECK TO SEE THAT ITEMS CHANGE WHEN LANGUAGE CHANGES
const getFilters = () => [
  {
    filterGroupName: i18next.t('public~Requester'),
    type: 'requester',
    reducer: (namespace) => {
      const name = namespace.metadata?.name;
      const requester = namespace.metadata?.annotations?.['openshift.io/requester'];
      if (isCurrentUser(requester)) {
        return REQUESTER_FILTER.ME;
      }
      if (isOtherUser(requester, name)) {
        return REQUESTER_FILTER.USER;
      }
      if (isSystemNamespace({ title: name })) {
        return REQUESTER_FILTER.SYSTEM;
      }
    },
    items: [
      { id: REQUESTER_FILTER.ME, title: i18next.t('public~Me') },
      { id: REQUESTER_FILTER.USER, title: i18next.t('public~User') },
      { id: REQUESTER_FILTER.SYSTEM, title: i18next.t('public~System'), hideIfEmpty: true },
    ],
  },
];

export const deleteModal = (kind, ns) => {
  const { labelKey, labelKind, weight, accessReview } = Kebab.factory.Delete(kind, ns);
  let callback = undefined;
  let tooltip;
  let label;

  if (ns.metadata.name === 'default') {
    tooltip = `${kind.label} default cannot be deleted`;
  } else if (ns.status?.phase === 'Terminating') {
    tooltip = `${kind.label} is already terminating`;
  } else {
    callback = () => deleteNamespaceModal({ kind, resource: ns });
  }
  if (tooltip) {
    label = (
      <div className="dropdown__disabled">
        <Tooltip content={tooltip}>
          <span>{i18next.t(labelKey, labelKind)}</span>
        </Tooltip>
      </div>
    );
  }
  return { label, labelKey, labelKind, weight, callback, accessReview };
};

const nsMenuActions = [
  Kebab.factory.ModifyLabels,
  Kebab.factory.ModifyAnnotations,
  Kebab.factory.Edit,
  deleteModal,
];

const fetchNamespaceMetrics = () => {
  const metrics = [
    {
      key: 'memory',
      query: 'sum by(namespace) (container_memory_working_set_bytes{container="",pod!=""})',
    },
    {
      key: 'cpu',
      query: 'namespace:container_cpu_usage:sum',
    },
  ];
  const promises = metrics.map(({ key, query }) => {
    const url = `${PROMETHEUS_BASE_PATH}/api/v1/query?&query=${query}`;
    return coFetchJSON(url).then(({ data: { result } }) => {
      return result.reduce((acc, data) => {
        const value = Number(data.value[1]);
        return _.set(acc, [key, data.metric.namespace], value);
      }, {});
    });
  });
  return (
    Promise.all(promises)
      .then((data) => _.assign({}, ...data))
      // eslint-disable-next-line no-console
      .catch(console.error)
  );
};

const namespaceColumnInfo = Object.freeze({
  name: {
    classes: '',
    id: 'name',
  },
  displayName: {
    classes: 'co-break-word',
    id: 'displayName',
  },
  status: {
    classes: '',
    id: 'status',
  },
  requester: {
    classes: '',
    id: 'requester',
  },
  memory: {
    classes: '',
    id: 'memory',
  },
  cpu: {
    classes: '',
    id: 'cpu',
  },
  created: {
    classes: '',
    id: 'created',
  },
  description: {
    classes: '',
    id: 'description',
  },
  labels: {
    classes: '',
    id: 'labels',
  },
});

const NamespacesTableHeader = () => {
  return [
    {
      title: i18next.t('public~Name'),
      id: namespaceColumnInfo.name.id,
      sortField: 'metadata.name',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.name.classes },
    },
    {
      title: i18next.t('public~Display name'),
      id: namespaceColumnInfo.displayName.id,
      sortField: 'metadata.annotations["openshift.io/display-name"]',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.displayName.classes },
    },
    {
      title: i18next.t('public~Status'),
      id: namespaceColumnInfo.status.id,
      sortField: 'status.phase',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.status.classes },
    },
    {
      title: i18next.t('public~Requester'),
      id: namespaceColumnInfo.requester.id,
      sortField: "metadata.annotations.['openshift.io/requester']",
      transforms: [sortable],
      props: { className: namespaceColumnInfo.requester.classes },
    },
    {
      title: i18next.t('public~Memory'),
      id: namespaceColumnInfo.memory.id,
      sortFunc: 'namespaceMemory',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.memory.classes },
    },
    {
      title: i18next.t('public~CPU'),
      id: namespaceColumnInfo.cpu.id,
      sortFunc: 'namespaceCPU',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.cpu.classes },
    },
    {
      title: i18next.t('public~Created'),
      id: namespaceColumnInfo.created.id,
      sortField: 'metadata.creationTimestamp',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.created.classes },
    },
    {
      title: i18next.t('public~Description'),
      id: namespaceColumnInfo.description.id,
      sortField: "metadata.annotations.['openshift.io/description']",
      transforms: [sortable],
      props: { className: namespaceColumnInfo.description.classes },
      additional: true,
    },
    {
      title: i18next.t('public~Labels'),
      id: namespaceColumnInfo.labels.id,
      sortField: 'metadata.labels',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.labels.classes },
      additional: true,
    },
    { title: '', props: { className: Kebab.columnClass } },
  ];
};
NamespacesTableHeader.displayName = 'NamespacesTableHeader';

const NamespacesColumnManagementID = referenceForModel(NamespaceModel);

const getNamespacesSelectedColumns = () => {
  return new Set(
    NamespacesTableHeader().reduce((acc, column) => {
      if (column.id && !column.additional) {
        acc.push(column.id);
      }
      return acc;
    }, []),
  );
};

const NamespacesTableRow = ({ obj: ns, customData: { tableColumns } }) => {
  const { t } = useTranslation();
  const metrics = useSelector(({ UI }) => UI.getIn(['metrics', 'namespace']));
  const name = getName(ns);
  const requester = getRequester(ns);
  const bytes = metrics?.memory?.[name];
  const cores = metrics?.cpu?.[name];
  const description = getDescription(ns);
  const labels = ns.metadata.labels;
  const columns = tableColumns?.length > 0 ? new Set(tableColumns) : getNamespacesSelectedColumns();
  return (
    <>
      <TableData className={namespaceColumnInfo.name.classes}>
        <ResourceLink kind="Namespace" name={ns.metadata.name} />
      </TableData>
      <TableData
        className={namespaceColumnInfo.displayName.classes}
        columns={columns}
        columnID={namespaceColumnInfo.displayName.id}
      >
        <span className="co-break-word co-line-clamp">
          {getDisplayName(ns) || (
            <span className="pf-v6-u-text-color-subtle">{t('public~No display name')}</span>
          )}
        </span>
      </TableData>
      <TableData
        className={css(namespaceColumnInfo.status.classes, 'co-break-word')}
        columns={columns}
        columnID={namespaceColumnInfo.status.id}
      >
        <Status status={ns.status?.phase} />
      </TableData>
      <TableData
        className={css(namespaceColumnInfo.requester.classes, 'co-break-word')}
        columns={columns}
        columnID={namespaceColumnInfo.requester.id}
      >
        {requester || <span className="pf-v6-u-text-color-subtle">{t('public~No requester')}</span>}
      </TableData>
      <TableData
        className={namespaceColumnInfo.memory.classes}
        columns={columns}
        columnID={namespaceColumnInfo.memory.id}
      >
        {bytes ? `${formatBytesAsMiB(bytes)} MiB` : '-'}
      </TableData>
      <TableData
        className={namespaceColumnInfo.cpu.classes}
        columns={columns}
        columnID={namespaceColumnInfo.cpu.id}
      >
        {cores ? t('public~{{cores}} cores', { cores: formatCores(cores) }) : '-'}
      </TableData>
      <TableData
        className={namespaceColumnInfo.created.classes}
        columns={columns}
        columnID={namespaceColumnInfo.created.id}
      >
        <Timestamp timestamp={ns.metadata.creationTimestamp} />
      </TableData>
      <TableData
        className={namespaceColumnInfo.description.classes}
        columns={columns}
        columnID={namespaceColumnInfo.description.id}
      >
        <span className="co-break-word co-line-clamp">
          {description || (
            <span className="pf-v6-u-text-color-subtle">{t('public~No description')}</span>
          )}
        </span>
      </TableData>
      <TableData
        className={namespaceColumnInfo.labels.classes}
        columns={columns}
        columnID={namespaceColumnInfo.labels.id}
      >
        <LabelList kind="Namespace" labels={labels} />
      </TableData>
      <TableData className={Kebab.columnClass}>
        <ResourceKebab actions={nsMenuActions} kind="Namespace" resource={ns} />
      </TableData>
    </>
  );
};

const NamespacesNotFoundMessage = () => {
  const { t } = useTranslation();
  return (
    <ConsoleEmptyState title={t('public~No Namespaces found')} Icon={SearchIcon}>
      {t('public~No results were found for the requested Namespaces.')}
    </ConsoleEmptyState>
  );
};

const NamespacesEmptyMessage = () => {
  const { t } = useTranslation();
  return (
    <ConsoleEmptyState title={t('public~No matching Namespaces')} Icon={SearchIcon}>
      {t('public~No results match the filter criteria.')}
    </ConsoleEmptyState>
  );
};

export const NamespacesList = (props) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [tableColumns] = useUserSettingsCompatibility(
    COLUMN_MANAGEMENT_CONFIGMAP_KEY,
    COLUMN_MANAGEMENT_LOCAL_STORAGE_KEY,
    undefined,
    true,
  );

  // TODO Utilize usePoll hook
  React.useEffect(() => {
    const updateMetrics = () =>
      fetchNamespaceMetrics().then((result) => dispatch(UIActions.setNamespaceMetrics(result)));
    updateMetrics();
    const id = setInterval(updateMetrics, 30 * 1000);
    return () => clearInterval(id);
  }, [dispatch]);
  const selectedColumns =
    tableColumns?.[NamespacesColumnManagementID]?.length > 0
      ? new Set(tableColumns[NamespacesColumnManagementID])
      : null;

  const customData = React.useMemo(
    () => ({
      tableColumns: tableColumns?.[NamespacesColumnManagementID],
    }),
    [tableColumns],
  );

  return (
    <Table
      {...props}
      activeColumns={selectedColumns}
      columnManagementID={NamespacesColumnManagementID}
      aria-label={t('public~Namespaces')}
      Header={NamespacesTableHeader}
      Row={NamespacesTableRow}
      customData={customData}
      virtualize
      EmptyMsg={NamespacesEmptyMessage}
      NoDataEmptyMsg={NamespacesNotFoundMessage}
    />
  );
};

export const NamespacesPage = (props) => {
  const { t } = useTranslation();
  const createNamespaceModal = useCreateNamespaceModal();
  const [tableColumns] = useUserSettingsCompatibility(
    COLUMN_MANAGEMENT_CONFIGMAP_KEY,
    COLUMN_MANAGEMENT_LOCAL_STORAGE_KEY,
    undefined,
    true,
  );
  const selectedColumns =
    tableColumns?.[NamespacesColumnManagementID]?.length > 0
      ? new Set(tableColumns[NamespacesColumnManagementID])
      : getNamespacesSelectedColumns();
  return (
    <ListPage
      {...props}
      rowFilters={getFilters()}
      ListComponent={NamespacesList}
      canCreate={true}
      createHandler={() => createNamespaceModal()}
      columnLayout={{
        columns: NamespacesTableHeader(null, t).map((column) =>
          _.pick(column, ['title', 'additional', 'id']),
        ),
        id: NamespacesColumnManagementID,
        selectedColumns,
        type: t('public~Namespaces'),
      }}
    />
  );
};

export const projectMenuActions = [Kebab.factory.Edit, deleteModal];

const projectColumnManagementID = referenceForModel(ProjectModel);

const projectTableHeader = ({ showMetrics, showActions }) => {
  return [
    {
      title: i18next.t('public~Name'),
      id: namespaceColumnInfo.name.id,
      sortField: 'metadata.name',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.name.classes },
    },
    {
      title: i18next.t('public~Display name'),
      id: namespaceColumnInfo.displayName.id,
      sortField: 'metadata.annotations["openshift.io/display-name"]',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.displayName.classes },
    },
    {
      title: i18next.t('public~Status'),
      id: namespaceColumnInfo.status.id,
      sortField: 'status.phase',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.status.classes },
    },
    {
      title: i18next.t('public~Requester'),
      id: namespaceColumnInfo.requester.id,
      sortField: "metadata.annotations.['openshift.io/requester']",
      transforms: [sortable],
      props: { className: namespaceColumnInfo.requester.classes },
    },
    ...(showMetrics
      ? [
          {
            title: i18next.t('public~Memory'),
            id: namespaceColumnInfo.memory.id,
            sortFunc: 'namespaceMemory',
            transforms: [sortable],
            props: { className: namespaceColumnInfo.memory.classes },
          },
          {
            title: i18next.t('public~CPU'),
            id: namespaceColumnInfo.cpu.id,
            sortFunc: 'namespaceCPU',
            transforms: [sortable],
            props: { className: namespaceColumnInfo.cpu.classes },
          },
        ]
      : []),
    {
      title: i18next.t('public~Created'),
      id: namespaceColumnInfo.created.id,
      sortField: 'metadata.creationTimestamp',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.created.classes },
    },
    {
      title: i18next.t('public~Description'),
      id: namespaceColumnInfo.description.id,
      sortField: "metadata.annotations.['openshift.io/description']",
      transforms: [sortable],
      props: { className: namespaceColumnInfo.description.classes },
      additional: true,
    },
    {
      title: i18next.t('public~Labels'),
      id: namespaceColumnInfo.labels.id,
      sortField: 'metadata.labels',
      transforms: [sortable],
      props: { className: namespaceColumnInfo.labels.classes },
      additional: true,
    },
    ...(showActions ? [{ title: '', props: { className: Kebab.columnClass } }] : []),
  ];
};

const getProjectSelectedColumns = ({ showMetrics, showActions }) => {
  return new Set(
    projectTableHeader({ showMetrics, showActions }).reduce((acc, column) => {
      if (column.id && !column.additional) {
        acc.push(column.id);
      }
      return acc;
    }, []),
  );
};

const ProjectLink = ({ project }) => {
  const dispatch = useDispatch();
  const [, setLastNamespace] = useUserSettingsCompatibility(
    LAST_NAMESPACE_NAME_USER_SETTINGS_KEY,
    LAST_NAMESPACE_NAME_LOCAL_STORAGE_KEY,
  );
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const basePath = url.pathname;
  if (params.has('project-name')) {
    // clear project-name query param from the url
    params.delete('project-name');
  }
  const newUrl = {
    search: `?${params.toString()}`,
    hash: url.hash,
  };
  const namespacedPath = UIActions.formatNamespaceRoute(project.metadata.name, basePath, newUrl);

  const handleClick = (e) => {
    // Don't set last namespace if its modified click (Ctrl+Click).
    if (isModifiedEvent(e)) {
      return;
    }
    setLastNamespace(project.metadata.name);
    // update last namespace in session storage (persisted only for current browser tab). Used to remember/restore if
    // "All Projects" was selected when returning to the list view (typically from details view) via breadcrumb or
    // sidebar navigation
    sessionStorage.setItem(LAST_NAMESPACE_NAME_LOCAL_STORAGE_KEY, project.metadata.name);
    // clear project-name filter when active namespace is changed
    dispatch(k8sActions.filterList(referenceForModel(ProjectModel), 'project-name', ''));
  };

  return (
    <span className="co-resource-item co-resource-item--truncate">
      <ResourceIcon kind="Project" />
      <Link to={namespacedPath} className="co-resource-item__resource-name" onClick={handleClick}>
        {project.metadata.name}
      </Link>
    </span>
  );
};
const projectHeaderWithoutActions = () =>
  projectTableHeader({ showMetrics: false, showActions: false });

const ProjectTableRow = ({ obj: project, customData = {} }) => {
  const { t } = useTranslation();
  const metrics = useSelector(({ UI }) => UI.getIn(['metrics', 'namespace']));
  const name = getName(project);
  const requester = getRequester(project);
  const {
    ProjectLinkComponent,
    actionsEnabled = true,
    showMetrics,
    showActions,
    isColumnManagementEnabled = true,
    tableColumns,
  } = customData;
  const bytes = metrics?.memory?.[name];
  const cores = metrics?.cpu?.[name];
  const description = getDescription(project);
  const labels = project.metadata.labels;
  const columns = isColumnManagementEnabled
    ? tableColumns?.length > 0
      ? new Set(tableColumns)
      : getProjectSelectedColumns({ showMetrics, showActions })
    : null;
  return (
    <>
      <TableData className={namespaceColumnInfo.name.classes}>
        {customData && ProjectLinkComponent ? (
          <ProjectLinkComponent project={project} />
        ) : (
          <span className="co-resource-item">
            <ResourceLink kind="Project" name={project.metadata.name} />
          </span>
        )}
      </TableData>
      <TableData
        className={namespaceColumnInfo.displayName.classes}
        columns={columns}
        columnID={namespaceColumnInfo.displayName.id}
      >
        <span className="co-break-word co-line-clamp">
          {getDisplayName(project) || (
            <span className="pf-v6-u-text-color-subtle">{t('public~No display name')}</span>
          )}
        </span>
      </TableData>
      <TableData
        className={namespaceColumnInfo.status.classes}
        columns={columns}
        columnID={namespaceColumnInfo.status.id}
      >
        <Status status={project.status?.phase} />
      </TableData>
      <TableData
        className={css(namespaceColumnInfo.requester.classes, 'co-break-word')}
        columns={columns}
        columnID={namespaceColumnInfo.requester.id}
      >
        {requester || <span className="pf-v6-u-text-color-subtle">{t('public~No requester')}</span>}
      </TableData>
      {showMetrics && (
        <>
          <TableData
            className={namespaceColumnInfo.memory.classes}
            columns={columns}
            columnID={namespaceColumnInfo.memory.id}
          >
            {bytes ? `${formatBytesAsMiB(bytes)} MiB` : '-'}
          </TableData>
          <TableData
            className={namespaceColumnInfo.cpu.classes}
            columns={columns}
            columnID={namespaceColumnInfo.cpu.id}
          >
            {cores ? t('public~{{cores}} cores', { cores: formatCores(cores) }) : '-'}
          </TableData>
        </>
      )}
      <TableData
        className={namespaceColumnInfo.created.classes}
        columns={columns}
        columnID={namespaceColumnInfo.created.id}
      >
        <Timestamp timestamp={project.metadata.creationTimestamp} />
      </TableData>
      {isColumnManagementEnabled && (
        <>
          <TableData
            className={namespaceColumnInfo.description.classes}
            columns={columns}
            columnID={namespaceColumnInfo.description.id}
          >
            <span className="co-break-word co-line-clamp">
              {description || (
                <span className="pf-v6-u-text-color-subtle">{t('public~No description')}</span>
              )}
            </span>
          </TableData>
          <TableData
            className={namespaceColumnInfo.labels.classes}
            columns={columns}
            columnID={namespaceColumnInfo.labels.id}
          >
            <LabelList labels={labels} kind="Project" />
          </TableData>
        </>
      )}
      {actionsEnabled && (
        <TableData className={Kebab.columnClass}>
          <ResourceKebab actions={projectMenuActions} kind="Project" resource={project} />
        </TableData>
      )}
    </>
  );
};
ProjectTableRow.displayName = 'ProjectTableRow';

export const ProjectsTable = (props) => {
  const { t } = useTranslation();
  const customData = React.useMemo(
    () => ({
      ProjectLinkComponent: ProjectLink,
      actionsEnabled: false,
      isColumnManagementEnabled: false,
    }),
    [],
  );
  return (
    <Table
      {...props}
      aria-label={t('public~Projects')}
      Header={projectHeaderWithoutActions}
      Row={ProjectTableRow}
      customData={customData}
      virtualize
    />
  );
};

const headerWithMetrics = () => projectTableHeader({ showMetrics: true, showActions: true });
const headerNoMetrics = () => projectTableHeader({ showMetrics: false, showActions: true });

const ProjectEmptyMessage = () => {
  const { t } = useTranslation();
  return (
    <ConsoleEmptyState title={t('public~No matching Projects')} icon={SearchIcon}>
      {t('public~No results match the filter criteria.')}
    </ConsoleEmptyState>
  );
};

export const ProjectList = ({ data, ...tableProps }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const canGetNS = useFlag(FLAGS.CAN_GET_NS);
  const [tableColumns] = useUserSettingsCompatibility(
    COLUMN_MANAGEMENT_CONFIGMAP_KEY,
    COLUMN_MANAGEMENT_LOCAL_STORAGE_KEY,
    undefined,
    true,
  );
  const isPrometheusAvailable = usePrometheusGate();
  const showMetrics = isPrometheusAvailable && canGetNS && window.screen.width >= 1200;
  const customData = React.useMemo(
    () => ({
      showMetrics,
      tableColumns: tableColumns?.[projectColumnManagementID],
    }),
    [showMetrics, tableColumns],
  );

  // TODO Utilize usePoll hook
  React.useEffect(() => {
    if (showMetrics) {
      const updateMetrics = () =>
        fetchNamespaceMetrics().then((result) => dispatch(UIActions.setNamespaceMetrics(result)));
      updateMetrics();
      const id = setInterval(updateMetrics, 30 * 1000);
      return () => clearInterval(id);
    }
  }, [dispatch, showMetrics]);
  const selectedColumns =
    tableColumns?.[projectColumnManagementID]?.length > 0
      ? new Set(tableColumns[projectColumnManagementID])
      : null;

  // Don't render the table until we know whether we can get metrics. It's
  // not possible to change the table headers once the component is mounted.
  if (flagPending(canGetNS)) {
    return null;
  }

  return (
    <Table
      {...tableProps}
      activeColumns={selectedColumns}
      columnManagementID={projectColumnManagementID}
      aria-label={t('public~Projects')}
      data={data}
      Header={showMetrics ? headerWithMetrics : headerNoMetrics}
      Row={ProjectTableRow}
      NoDataEmptyMsg={OpenShiftGettingStarted}
      EmptyMsg={ProjectEmptyMessage}
      customData={customData}
      virtualize
    />
  );
};

export const ProjectsPage = (props) => {
  const { t } = useTranslation();
  const createProjectModal = useCreateProjectModal();
  // Skip self-subject access review for projects since they use a special project request API.
  // `FLAGS.CAN_CREATE_PROJECT` determines if the user can create projects.
  const canGetNS = useFlag(FLAGS.CAN_GET_NS);
  const canCreateProject = useFlag(FLAGS.CAN_CREATE_PROJECT);
  const [tableColumns] = useUserSettingsCompatibility(
    COLUMN_MANAGEMENT_CONFIGMAP_KEY,
    COLUMN_MANAGEMENT_LOCAL_STORAGE_KEY,
    undefined,
    true,
  );
  const isPrometheusAvailable = usePrometheusGate();
  const showMetrics = isPrometheusAvailable && canGetNS && window.screen.width >= 1200;
  const showActions = showMetrics;
  return (
    <ListPage
      {...props}
      rowFilters={getFilters()}
      ListComponent={ProjectList}
      canCreate={canCreateProject}
      createHandler={() => createProjectModal()}
      filterLabel={t('public~by name or display name')}
      skipAccessReview
      textFilter="project-name"
      kind="Project"
      columnLayout={{
        columns: projectTableHeader({ showMetrics, showActions }).map((column) =>
          _.pick(column, ['title', 'additional', 'id']),
        ),
        id: projectColumnManagementID,
        selectedColumns:
          tableColumns?.[projectColumnManagementID]?.length > 0
            ? new Set(tableColumns[projectColumnManagementID])
            : null,
        type: t('public~Project'),
      }}
    />
  );
};

/** @type {React.SFC<{namespace: K8sResourceKind}>} */
export const PullSecret = (props) => {
  const [isLoading, setIsLoading] = React.useState(true);
  const [data, setData] = React.useState([]);
  const [error, setError] = React.useState(false);
  const { t } = useTranslation();
  const { namespace, canViewSecrets } = props;

  React.useEffect(() => {
    k8sGet(ServiceAccountModel, 'default', namespace.metadata.name, {})
      .then((serviceAccount) => {
        setIsLoading(false);
        setData(serviceAccount.imagePullSecrets ?? []);
        setError(false);
      })
      .catch((err) => {
        setIsLoading(false);
        setData([]);
        setError(true);
        // eslint-disable-next-line no-console
        console.error('Error getting default ServiceAccount', err);
      });
  }, [namespace.metadata.name]);

  const modal = () => configureNamespacePullSecretModal({ namespace, pullSecret: undefined });

  const secrets = () => {
    if (error) {
      return <Alert variant="danger" isInline title={t('Error loading default pull Secrets')} />;
    }
    return data.length > 0 ? (
      data.map((secret) => (
        <div key={secret.name}>
          <ResourceLink
            kind="Secret"
            name={secret.name}
            namespace={namespace.metadata.name}
            linkTo={canViewSecrets}
          />
        </div>
      ))
    ) : (
      <Button
        icon={<PencilAltIcon />}
        iconPosition="end"
        variant="link"
        type="button"
        isInline
        onClick={modal}
      >
        {t('public~Not configured')}
      </Button>
    );
  };

  return (
    <DescriptionListGroup>
      <DescriptionListTerm>
        {t('public~Default pull Secret', { count: data.length })}
      </DescriptionListTerm>
      <DescriptionListDescription>
        {isLoading ? <LoadingInline /> : secrets()}
      </DescriptionListDescription>
    </DescriptionListGroup>
  );
};

export const NamespaceLineCharts = ({ ns }) => {
  const { t } = useTranslation();
  return (
    <Grid hasGutter>
      <GridItem md={6}>
        <Area
          title={t('public~CPU usage')}
          humanize={humanizeCpuCores}
          namespace={ns.metadata.name}
          query={`namespace:container_cpu_usage:sum{namespace='${ns.metadata.name}'}`}
        />
      </GridItem>
      <GridItem md={6}>
        <Area
          title={t('public~Memory usage')}
          humanize={humanizeBinaryBytes}
          byteDataType={ByteDataTypes.BinaryBytes}
          namespace={ns.metadata.name}
          query={`sum by(namespace) (container_memory_working_set_bytes{namespace="${ns.metadata.name}",container="",pod!=""})`}
        />
      </GridItem>
    </Grid>
  );
};

export const TopPodsBarChart = ({ ns }) => {
  const { t } = useTranslation();
  return (
    <Bar
      title={t('public~Memory usage by pod (top 10)')}
      namespace={ns.metadata.name}
      query={`sort_desc(topk(10, sum by (pod)(container_memory_working_set_bytes{container="",pod!="",namespace="${ns.metadata.name}"})))`}
      humanize={humanizeBinaryBytes}
      metric="pod"
    />
  );
};

const ResourceUsage = ({ ns }) => {
  const { t } = useTranslation();
  const isPrometheusAvailable = usePrometheusGate();
  return isPrometheusAvailable ? (
    <PaneBody>
      <SectionHeading text={t('public~Resource usage')} />
      <NamespaceLineCharts ns={ns} />
      <TopPodsBarChart ns={ns} />
    </PaneBody>
  ) : null;
};

export const NamespaceSummary = ({ ns }) => {
  const { t } = useTranslation();
  const displayName = getDisplayName(ns);
  const description = getDescription(ns);
  const requester = getRequester(ns);
  const serviceMeshEnabled = ns.metadata?.labels?.['maistra.io/member-of'];
  const canListSecrets = useAccessReview({
    group: SecretModel.apiGroup,
    resource: SecretModel.plural,
    verb: 'patch',
    namespace: ns.metadata.name,
  });

  return (
    <Grid hasGutter>
      <GridItem sm={6}>
        {/* Labels aren't editable on kind Project, only Namespace. */}
        <ResourceSummary resource={ns} showLabelEditor={ns.kind === 'Namespace'}>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('public~Display name')}</DescriptionListTerm>
            <DescriptionListDescription
              className={css({
                'text-muted': !displayName,
              })}
            >
              {displayName || t('public~No display name')}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t('public~Description')}</DescriptionListTerm>
            <DescriptionListDescription>
              <p
                className={css({
                  'pf-v6-u-text-color-subtle': !description,
                  'co-pre-wrap': description,
                  'co-namespace-summary__description': description,
                })}
              >
                {description || t('public~No description')}
              </p>
            </DescriptionListDescription>
          </DescriptionListGroup>
          {requester && (
            <DescriptionListGroup>
              <DescriptionListTerm>Requester</DescriptionListTerm>{' '}
              <DescriptionListDescription>{requester}</DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </ResourceSummary>
      </GridItem>
      <GridItem sm={6}>
        <DescriptionList>
          <DetailsItem label={t('public~Status')} obj={ns} path="status.phase">
            <Status status={ns.status?.phase} />
          </DetailsItem>
          <PullSecret namespace={ns} canViewSecrets={canListSecrets} />
          <DescriptionListGroup>
            <DescriptionListTerm>{t('public~NetworkPolicies')}</DescriptionListTerm>
            <DescriptionListDescription>
              <Link to={`/k8s/ns/${ns.metadata.name}/networkpolicies`}>
                {t('public~NetworkPolicies')}
              </Link>
            </DescriptionListDescription>
          </DescriptionListGroup>
          {serviceMeshEnabled && (
            <DescriptionListGroup>
              <DescriptionListTerm>{t('public~Service mesh')}</DescriptionListTerm>
              <DescriptionListDescription>
                <GreenCheckCircleIcon /> {t('public~Service mesh enabled')}
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </DescriptionList>
      </GridItem>
    </Grid>
  );
};

export const NamespaceDetails = ({ obj: ns, customData }) => {
  const { t } = useTranslation();
  const [perspective] = useActivePerspective();
  const [consoleLinks] = useK8sWatchResource({
    isList: true,
    kind: referenceForModel(ConsoleLinkModel),
    optional: true,
  });
  const links = getNamespaceDashboardConsoleLinks(ns, consoleLinks);
  return (
    <div>
      {perspective === 'dev' && <DocumentTitle>{t('public~Project details')}</DocumentTitle>}
      <PaneBody>
        {!customData?.hideHeading && (
          <SectionHeading text={t('public~{{kind}} details', { kind: ns.kind })} />
        )}
        <NamespaceSummary ns={ns} />
      </PaneBody>
      {ns.kind === 'Namespace' && <ResourceUsage ns={ns} />}
      {!_.isEmpty(links) && (
        <PaneBody>
          <SectionHeading text={t('public~Launcher')} />
          <ul className="pf-v6-c-list pf-m-plain">
            {_.map(_.sortBy(links, 'spec.text'), (link) => {
              return (
                <li key={link.metadata.uid}>
                  <ExternalLink href={link.spec.href} text={link.spec.text} />
                </li>
              );
            })}
          </ul>
        </PaneBody>
      )}
    </div>
  );
};

const RolesPage = ({ obj: { metadata } }) => {
  return (
    <RoleBindingsPage
      createPath={`/k8s/ns/${metadata.name}/rolebindings/~new`}
      namespace={metadata.name}
      showTitle={false}
    />
  );
};

export const NamespacesDetailsPage = (props) => (
  <DetailsPage
    {...props}
    menuActions={nsMenuActions}
    pages={[
      navFactory.details(NamespaceDetails),
      navFactory.editYaml(),
      navFactory.roles(RolesPage),
    ]}
  />
);

export const ProjectsDetailsPage = (props) => {
  return (
    <DetailsPage
      {...props}
      menuActions={projectMenuActions}
      pages={[
        {
          href: '',
          // t('public~Overview')
          nameKey: 'public~Overview',
          component: ProjectDashboard,
        },
        {
          href: 'details',
          // t('public~Details')
          nameKey: 'public~Details',
          component: NamespaceDetails,
        },
        navFactory.editYaml(),
        navFactory.workloads(OverviewListPage),
        navFactory.roles(RolesPage),
      ]}
    />
  );
};
