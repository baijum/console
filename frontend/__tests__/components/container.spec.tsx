import {
  ContainersDetailsPage,
  ContainerDetails,
  ContainerDetailsList,
} from '../../public/components/container';
import { mount, ReactWrapper, shallow } from 'enzyme';
import store from '@console/internal/redux';
import { Provider } from 'react-redux';
import * as ReactRouter from 'react-router-dom-v5-compat';
import { useLocation } from 'react-router';
import {
  Firehose,
  HorizontalNav,
  LoadingBox,
  ConnectedPageHeading,
  ConnectedPageHeadingProps,
} from '@console/internal/components/utils';
import { useFavoritesOptions } from '@console/internal/components/useFavoritesOptions';
import { testPodInstance } from '../../__mocks__/k8sResourcesMocks';
import { Status } from '@console/shared';
import { ErrorPage404 } from '@console/internal/components/error';
import { StatusProps } from '@console/metal3-plugin/src/components/types';
import { act } from 'react-dom/test-utils';

jest.mock('react-router', () => ({
  useLocation: jest.fn(),
}));

const useFavoritesOptionsMock = useFavoritesOptions as jest.Mock;
const useLocationMock = useLocation as jest.Mock;

jest.mock('react-router-dom-v5-compat', () => ({
  ...jest.requireActual('react-router-dom-v5-compat'),
  useParams: jest.fn(),
  useLocation: jest.fn(),
}));
jest.mock('@console/internal/components/useFavoritesOptions', () => ({
  useFavoritesOptions: jest.fn(),
}));

describe(ContainersDetailsPage.displayName, () => {
  let containerDetailsPage: ReactWrapper;

  beforeEach(() => {
    jest.spyOn(ReactRouter, 'useParams').mockReturnValue({ podName: 'test-name', ns: 'default' });
    jest.spyOn(ReactRouter, 'useLocation').mockReturnValue({ pathname: '' });
    useLocationMock.mockReturnValue({ pathname: '' });
    useFavoritesOptionsMock.mockReturnValue([[], jest.fn(), true]);

    containerDetailsPage = mount(<ContainersDetailsPage />, {
      wrappingComponent: ({ children }) => <Provider store={store}>{children}</Provider>,
    });
  });

  it('renders a `Firehose` using the given props', () => {
    const firehoseResources = containerDetailsPage.find<any>(Firehose).props().resources[0];
    expect(firehoseResources).toEqual({
      name: 'test-name',
      namespace: 'default',
      kind: 'Pod',
      isList: false,
      prop: 'obj',
    });
  });
});

describe(ContainerDetails.displayName, () => {
  const obj = { data: { ...testPodInstance } };

  it('renders a `ConnectedPageHeading` and a `ContainerDetails` with the same state', async () => {
    jest
      .spyOn(ReactRouter, 'useParams')
      .mockReturnValue({ podName: 'test-name', ns: 'default', name: 'crash-app' });

    jest.spyOn(ReactRouter, 'useLocation').mockReturnValue({ pathname: '' });
    // Full mount needed to get the children of the ConnectedPageHeading within the ContainerDetails without warning
    let containerDetails: ReactWrapper;
    await act(async () => {
      containerDetails = mount(<ContainerDetails obj={obj} loaded={true} />, {
        wrappingComponent: ({ children }) => (
          <Provider store={store}>
            <ReactRouter.BrowserRouter>{children}</ReactRouter.BrowserRouter>
          </Provider>
        ),
      });
    });

    const pageHeadingStatusProps = containerDetails
      .find<ConnectedPageHeadingProps>(ConnectedPageHeading)
      .children()
      .find<StatusProps>(Status)
      .props();

    const containerDetailsList = shallow(
      containerDetails
        .find<any>(HorizontalNav)
        .props()
        .pages[0].component({ obj: testPodInstance }),
    );

    const containerDetailsStatusProps = containerDetailsList.find<StatusProps>(Status).props();

    expect(pageHeadingStatusProps.status).toEqual('Waiting');
    expect(containerDetailsStatusProps.status).toEqual('Waiting');
  });

  it("renders a `ErrorPage404` if the container to render doesn't exist", () => {
    jest
      .spyOn(ReactRouter, 'useParams')
      .mockReturnValue({ podName: 'test-name', ns: 'default', name: 'non-existing-container' });

    jest.spyOn(ReactRouter, 'useLocation').mockReturnValue({ pathname: '' });

    const containerDetails = mount(
      <Provider store={store}>
        <ReactRouter.BrowserRouter>
          <ContainerDetails obj={obj} loaded={true} />
        </ReactRouter.BrowserRouter>
      </Provider>,
    );

    expect(containerDetails.containsMatchingElement(<ErrorPage404 />)).toBe(true);
  });

  it("renders a `LoadingBox` if props aren't loaded yet", () => {
    jest
      .spyOn(ReactRouter, 'useParams')
      .mockReturnValue({ podName: 'test-name', ns: 'default', name: 'crash-app' });
    jest.spyOn(ReactRouter, 'useLocation').mockReturnValue({ pathname: '' });
    const containerDetails = mount(
      <ReactRouter.BrowserRouter>
        <ContainerDetails obj={obj} loaded={false} />
      </ReactRouter.BrowserRouter>,
    );

    expect(containerDetails.containsMatchingElement(<LoadingBox />)).toBe(true);
  });
});

describe(ContainerDetailsList.displayName, () => {
  it("renders a `ErrorPage404` if the container to render doesn't exist", () => {
    jest
      .spyOn(ReactRouter, 'useParams')
      .mockReturnValue({ podName: 'test-name', ns: 'default', name: 'non-existing-container' });

    const containerDetailsList = mount(<ContainerDetailsList obj={testPodInstance} />, {
      wrappingComponent: ({ children }) => (
        <Provider store={store}>
          <ReactRouter.BrowserRouter>{children}</ReactRouter.BrowserRouter>
        </Provider>
      ),
    });

    expect(containerDetailsList.containsMatchingElement(<ErrorPage404 />)).toBe(true);
  });
});
