import * as _ from 'lodash';
import { getProbesData } from '@console/dev-console/src/components/health-checks/create-health-checks-probe-utils';
import {
  DeployImageFormData,
  GitImportFormData,
  UploadJarFormData,
} from '@console/dev-console/src/components/import/import-types';
import { CUSTOM_ICON_ANNOTATION } from '@console/dev-console/src/const';
import { getAppLabels, mergeData } from '@console/dev-console/src/utils/resource-label-utils';
import { ImportStrategy } from '@console/git-service/src';
import {
  K8sResourceKind,
  ImagePullPolicy,
  k8sGet,
  k8sCreate,
  k8sUpdate,
  k8sKill,
} from '@console/internal/module/k8s';
import type { NameValuePair } from '@console/shared/src/components/formik-fields/field-types';
import { ServiceModel, DomainMappingModel } from '../models';
import { DomainMappingResponse, DomainMappingResponseAction } from '../types';

export const dryRunOpt = { queryParams: { dryRun: 'All' } };
export const getKnativeServiceDepResource = (
  formData: GitImportFormData | DeployImageFormData | UploadJarFormData,
  imageStreamUrl: string,
  imageStreamName?: string,
  imageStreamTag?: string,
  imageNamespace?: string,
  annotations?: { [name: string]: string },
  originalKnativeService?: K8sResourceKind,
  generatedImageStreamName?: string,
): K8sResourceKind => {
  const {
    name,
    application: { name: applicationName },
    project: { name: namespace },
    runtimeIcon,
    serverless: { scaling },
    limits,
    route: { unknownTargetPort, create, defaultUnknownPort },
    labels,
    image: { tag: imageTag },
    deployment: {
      env,
      triggers: { image: imagePolicy },
    },
    healthChecks,
    resources,
    formType,
    customIcon,
  } = formData;
  const { fileUpload } = formData as UploadJarFormData;
  const selectedStrategy = formData?.import?.selectedStrategy;

  const contTargetPort = parseInt(unknownTargetPort, 10) || defaultUnknownPort;
  const imgPullPolicy = imagePolicy ? ImagePullPolicy.Always : ImagePullPolicy.IfNotPresent;
  const {
    concurrencylimit,
    concurrencytarget,
    minpods,
    maxpods,
    autoscale: { autoscalewindow, autoscalewindowUnit },
    concurrencyutilization,
  } = scaling;
  const {
    cpu: {
      request: cpuRequest,
      requestUnit: cpuRequestUnit,
      limit: cpuLimit,
      limitUnit: cpuLimitUnit,
    },
    memory: {
      request: memoryRequest,
      requestUnit: memoryRequestUnit,
      limit: memoryLimit,
      limitUnit: memoryLimitUnit,
    },
  } = limits;
  const defaultLabel = getAppLabels({
    name,
    applicationName,
    imageStreamName,
    selectedTag: imageStreamTag || imageTag,
    namespace: imageNamespace,
    runtimeIcon,
  });
  delete defaultLabel.app;
  if (fileUpload) {
    const jArgsIndex = env?.findIndex((e) => e.name === 'JAVA_ARGS');
    if (jArgsIndex !== -1) {
      if (fileUpload.javaArgs !== '') {
        (env[jArgsIndex] as NameValuePair).value = fileUpload.javaArgs;
      } else {
        env.splice(jArgsIndex, 1);
      }
    } else if (fileUpload.javaArgs !== '') {
      env.push({ name: 'JAVA_ARGS', value: fileUpload.javaArgs });
    }
  }
  const newKnativeDeployResource: K8sResourceKind = {
    kind: ServiceModel.kind,
    apiVersion: `${ServiceModel.apiGroup}/${ServiceModel.apiVersion}`,
    metadata: {
      name,
      namespace,
      labels: {
        ...defaultLabel,
        ...labels,
        ...(formType === 'serverlessFunction' && { 'function.knative.dev': 'true' }),
        ...(!create && { 'networking.knative.dev/visibility': `cluster-local` }),
        ...(((formData as GitImportFormData).pipeline?.enabled || generatedImageStreamName) && {
          'app.kubernetes.io/name': name,
        }),
        ...(selectedStrategy &&
          selectedStrategy?.type === ImportStrategy.SERVERLESS_FUNCTION && {
            'function.knative.dev': 'true',
          }),
      },
      annotations: fileUpload ? { ...annotations, jarFileName: fileUpload.name } : annotations,
    },
    spec: {
      template: {
        metadata: {
          labels: {
            ...defaultLabel,
            ...labels,
            'app.kubernetes.io/name': generatedImageStreamName
              ? formData.name
              : labels['app.kubernetes.io/name'],
          },
          annotations: {
            ...(concurrencytarget && {
              'autoscaling.knative.dev/target': `${concurrencytarget}`,
            }),
            ...(minpods && { 'autoscaling.knative.dev/min-scale': `${minpods}` }),
            ...(maxpods && { 'autoscaling.knative.dev/max-scale': `${maxpods}` }),
            ...(autoscalewindow && {
              'autoscaling.knative.dev/window': `${autoscalewindow}${autoscalewindowUnit}`,
            }),
            ...(concurrencyutilization && {
              'autoscaling.knative.dev/target-utilization-percentage': `${concurrencyutilization}`,
            }),
            ...(customIcon && {
              [CUSTOM_ICON_ANNOTATION]: customIcon,
            }),
          },
        },
        spec: {
          ...(concurrencylimit && { containerConcurrency: concurrencylimit }),
          containers: [
            {
              name,
              image: `${imageStreamUrl}`,
              ...(contTargetPort && {
                ports: [
                  {
                    containerPort: contTargetPort,
                  },
                ],
              }),
              imagePullPolicy: imgPullPolicy,
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: {
                  drop: ['ALL'],
                },
                runAsNonRoot: true,
                seccompProfile: {
                  type: 'RuntimeDefault',
                },
              },
              env,
              resources: {
                ...((cpuLimit || memoryLimit) && {
                  limits: {
                    ...(cpuLimit && { cpu: `${cpuLimit}${cpuLimitUnit}` }),
                    ...(memoryLimit && { memory: `${memoryLimit}${memoryLimitUnit}` }),
                  },
                }),
                ...((cpuRequest || memoryRequest) && {
                  requests: {
                    ...(cpuRequest && { cpu: `${cpuRequest}${cpuRequestUnit}` }),
                    ...(memoryRequest && { memory: `${memoryRequest}${memoryRequestUnit}` }),
                  },
                }),
              },
              ...getProbesData(healthChecks, resources),
            },
          ],
        },
      },
    },
  };
  let knativeServiceUpdated = {};
  if (!_.isEmpty(originalKnativeService)) {
    knativeServiceUpdated = _.omit(originalKnativeService, [
      'status',
      'spec.template.metadata.name',
      'spec.template.spec.containers',
    ]);
  }
  const knativeDeployResource = mergeData(knativeServiceUpdated || {}, newKnativeDeployResource);

  return knativeDeployResource;
};

const getDomainMappingDeleteList = (
  ksvcName: string,
  allDomainMapping: K8sResourceKind[],
  selDomainMappingNames: string[],
): DomainMappingResponse[] => {
  return allDomainMapping
    .filter((dmRes) => dmRes.spec?.ref?.name === ksvcName)
    .filter((dmSvc) => !selDomainMappingNames?.includes(dmSvc.metadata.name))
    .map((dmDel) => ({
      action: DomainMappingResponseAction.Delete,
      resource: dmDel,
    }));
};

const formDomainMappingStruct = (
  name: string,
  knativeSvcResource: K8sResourceKind,
  curDomainMapping?: K8sResourceKind,
): K8sResourceKind => {
  const {
    kind,
    apiVersion,
    metadata: { name: svcName, namespace },
  } = knativeSvcResource;
  return {
    ...(curDomainMapping
      ? { ...curDomainMapping }
      : {
          kind: DomainMappingModel.kind,
          apiVersion: `${DomainMappingModel.apiGroup}/${DomainMappingModel.apiVersion}`,
          metadata: {
            name,
            namespace,
          },
        }),
    spec: {
      ref: {
        name: svcName,
        kind,
        apiVersion,
      },
    },
  };
};

export const getDomainMappingResources = (
  knativeSvcResource: K8sResourceKind,
  selectedDomainMapping: string[],
): Promise<DomainMappingResponse[]> => {
  const {
    metadata: { name, namespace },
  } = knativeSvcResource;
  const domainMappingResources = [];
  return k8sGet(DomainMappingModel, null, namespace)
    .then((res) => {
      const allDomainMappingList = res.items;
      if (!selectedDomainMapping?.length && !allDomainMappingList?.length) {
        return Promise.resolve([]);
      }

      // form domain mapping to be deleted
      const dmDeleteList = getDomainMappingDeleteList(
        name,
        allDomainMappingList,
        selectedDomainMapping,
      );
      domainMappingResources.push(...dmDeleteList);

      // form domain mapping to be created or updated
      const dmCreateUpdateList = selectedDomainMapping.map((domainName) => {
        const curDomainMapping = allDomainMappingList.find(
          (curDomain) => curDomain.metadata.name === domainName,
        );
        let domainMappingResourceData: DomainMappingResponse;
        if (curDomainMapping) {
          domainMappingResourceData = {
            action: DomainMappingResponseAction.Update,
            resource: formDomainMappingStruct(domainName, knativeSvcResource, curDomainMapping),
          };
        } else {
          domainMappingResourceData = {
            action: DomainMappingResponseAction.Create,
            resource: formDomainMappingStruct(domainName, knativeSvcResource),
          };
        }
        return domainMappingResourceData;
      });
      domainMappingResources.push(...dmCreateUpdateList);

      return domainMappingResources;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.log('Failed to get domain mapping resources', err);
      return domainMappingResources;
    });
};

export const getDomainMappingRequests = async (
  formData: GitImportFormData | DeployImageFormData | UploadJarFormData,
  knativeSvcResource: K8sResourceKind,
  dryRun: boolean,
): Promise<Promise<K8sResourceKind>[]> => {
  const {
    serverless: { domainMapping: selectedDomainMapping = [] },
  } = formData;
  const domainMappingResources = await getDomainMappingResources(knativeSvcResource, [
    ...new Set(selectedDomainMapping.map((dm) => dm.replace(/ *\([^)]*\) */g, ''))),
  ]);
  const requests: Promise<K8sResourceKind>[] = [];
  domainMappingResources.length &&
    domainMappingResources.forEach(({ action, resource: dmRes }) => {
      switch (action) {
        case DomainMappingResponseAction.Create:
          requests.push(k8sCreate(DomainMappingModel, dmRes, dryRun ? dryRunOpt : {}));
          break;
        case DomainMappingResponseAction.Update:
          requests.push(k8sUpdate(DomainMappingModel, dmRes, null, null, dryRun ? dryRunOpt : {}));
          break;
        case DomainMappingResponseAction.Delete:
          requests.push(k8sKill(DomainMappingModel, dmRes, dryRun ? dryRunOpt : {}));
          break;
        default:
          break;
      }
    });
  return requests;
};
