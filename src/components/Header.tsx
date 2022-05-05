import {
    Box,
    Flex,
    Heading,
    HStack,
    IconButton,
    Image,
    Spacer,
    Tag,
    useColorModeValue,
} from '@chakra-ui/react';
import { memo, useContext, useEffect, useState } from 'react';
import { IoPause, IoPlay, IoStop } from 'react-icons/io5';
import { useThrottledCallback } from 'use-debounce';
import { getBackend } from '../helpers/Backend';
import checkNodeValidity from '../helpers/checkNodeValidity';
import { AlertBoxContext, AlertType } from '../helpers/contexts/AlertBoxContext';
import { GlobalContext } from '../helpers/contexts/GlobalNodeState';
import { SettingsContext } from '../helpers/contexts/SettingsContext';
import { useAsyncEffect } from '../helpers/hooks/useAsyncEffect';
import {
    BackendEventSourceListener,
    useBackendEventSource,
    useBackendEventSourceListener,
} from '../helpers/hooks/useBackendEventSource';
import { ipcRenderer } from '../helpers/safeIpc';
import logo from '../public/icons/png/256x256.png';
import { DependencyManagerButton } from './DependencyManager';
import { SettingsButton } from './SettingsModal';
import SystemStats from './SystemStats';

interface HeaderProps {
    port: number;
}

const Header = ({ port }: HeaderProps) => {
    const {
        convertToUsableFormat,
        useAnimateEdges,
        nodes,
        edges,
        availableNodes,
        setIteratorPercent,
    } = useContext(GlobalContext);

    const { useIsCpu, useIsFp16 } = useContext(SettingsContext);

    const { showMessageBox } = useContext(AlertBoxContext);

    const [isCpu] = useIsCpu;
    const [isFp16] = useIsFp16;

    const [animateEdges, unAnimateEdges, completeEdges, clearCompleteEdges] = useAnimateEdges();

    const [running, setRunning] = useState(false);
    const backend = getBackend(port);

    useEffect(() => {
        if (!running) {
            unAnimateEdges();
        }
    }, [running]);

    const [eventSource, eventSourceStatus] = useBackendEventSource(port);

    useBackendEventSourceListener(
        eventSource,
        'finish',
        () => {
            clearCompleteEdges();
            setRunning(false);
        },
        [setRunning, clearCompleteEdges]
    );

    useBackendEventSourceListener(
        eventSource,
        'execution-error',
        (data) => {
            if (data) {
                showMessageBox(AlertType.ERROR, null, data.exception);
                unAnimateEdges();
                setRunning(false);
            }
        },
        [setRunning, unAnimateEdges]
    );

    const updateNodeFinish = useThrottledCallback<BackendEventSourceListener<'node-finish'>>(
        (data) => {
            if (data) {
                completeEdges(data.finished);
            }
        },
        350
    );
    useBackendEventSourceListener(eventSource, 'node-finish', updateNodeFinish, [
        completeEdges,
        updateNodeFinish,
    ]);

    const updateIteratorProgress = useThrottledCallback<
        BackendEventSourceListener<'iterator-progress-update'>
    >((data) => {
        if (data) {
            const { percent, iteratorId, running: runningNodes } = data;
            if (runningNodes && running) {
                animateEdges(runningNodes);
            } else if (!running) {
                unAnimateEdges();
            }
            setIteratorPercent(iteratorId, percent);
        }
    }, 350);
    useBackendEventSourceListener(eventSource, 'iterator-progress-update', updateIteratorProgress, [
        animateEdges,
        updateIteratorProgress,
    ]);

    useEffect(() => {
        if (eventSourceStatus === 'error') {
            showMessageBox(
                AlertType.ERROR,
                null,
                'An unexpected error occurred. You may need to restart chaiNNer.'
            );
            unAnimateEdges();
            setRunning(false);
        }
    }, [eventSourceStatus]);

    const [appVersion, setAppVersion] = useState('#.#.#');
    useAsyncEffect(
        {
            supplier: () => ipcRenderer.invoke('get-app-version'),
            successEffect: setAppVersion,
        },
        []
    );

    const run = async () => {
        setRunning(true);
        animateEdges();
        if (nodes.length === 0) {
            showMessageBox(AlertType.ERROR, null, 'There are no nodes to run.');
        } else {
            const nodeValidities = nodes.map((node) => {
                const { inputs } = availableNodes[node.data.category][node.data.type];
                return [
                    ...checkNodeValidity({
                        id: node.id,
                        inputData: node.data.inputData,
                        edges,
                        inputs,
                    }),
                    node.data.type,
                ] as const;
            });
            const invalidNodes = nodeValidities.filter(([isValid]) => !isValid);
            if (invalidNodes.length > 0) {
                const reasons = invalidNodes
                    .map(([, reason, type]) => `• ${type}: ${reason}`)
                    .join('\n');
                showMessageBox(
                    AlertType.ERROR,
                    null,
                    `There are invalid nodes in the editor. Please fix them before running.\n${reasons}`
                );
                unAnimateEdges();
                setRunning(false);
                return;
            }
            try {
                const data = convertToUsableFormat();
                const response = await backend.run({
                    data,
                    isCpu,
                    isFp16: isFp16 && !isCpu,
                    // We actually do not want to adjust for scaling here,
                    // as imshow does not take that into account
                    // resolutionX: Math.floor(window.screen.width * window.devicePixelRatio),
                    // resolutionY: Math.floor(window.screen.height * window.devicePixelRatio),
                    resolutionX: window.screen.width,
                    resolutionY: window.screen.height,
                });
                if (response.exception) {
                    showMessageBox(AlertType.ERROR, null, response.exception);
                    unAnimateEdges();
                    setRunning(false);
                }
            } catch (err) {
                showMessageBox(AlertType.ERROR, null, 'An unexpected error occurred.');
                unAnimateEdges();
                setRunning(false);
            }
        }
    };

    const pause = async () => {
        try {
            const response = await backend.pause();
            if (response.exception) {
                showMessageBox(AlertType.ERROR, null, response.exception);
            }
        } catch (err) {
            showMessageBox(AlertType.ERROR, null, 'An unexpected error occurred.');
        }
        setRunning(false);
        unAnimateEdges();
    };

    const kill = async () => {
        try {
            const response = await backend.kill();
            clearCompleteEdges();
            if (response.exception) {
                showMessageBox(AlertType.ERROR, null, response.exception);
            }
        } catch (err) {
            showMessageBox(AlertType.ERROR, null, 'An unexpected error occurred.');
        }
        unAnimateEdges();
        setRunning(false);
    };

    return (
        <>
            <Box
                bg={useColorModeValue('gray.100', 'gray.800')}
                borderRadius="lg"
                borderWidth="1px"
                h="56px"
                w="100%"
            >
                <Flex
                    align="center"
                    h="100%"
                    p={2}
                >
                    <HStack>
                        {/* <LinkIcon /> */}
                        <Image
                            boxSize="36px"
                            draggable={false}
                            src={logo}
                        />
                        <Heading size="md">chaiNNer</Heading>
                        <Tag>Alpha</Tag>
                        <Tag>{`v${appVersion}`}</Tag>
                    </HStack>
                    <Spacer />

                    <HStack>
                        <IconButton
                            aria-label="Start button"
                            colorScheme="green"
                            disabled={running}
                            icon={<IoPlay />}
                            size="md"
                            variant="outline"
                            onClick={() => {
                                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                                run();
                            }}
                        />
                        <IconButton
                            aria-label="Pause button"
                            colorScheme="yellow"
                            disabled={!running}
                            icon={<IoPause />}
                            size="md"
                            variant="outline"
                            onClick={() => {
                                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                                pause();
                            }}
                        />
                        <IconButton
                            aria-label="Stop button"
                            colorScheme="red"
                            disabled={!running}
                            icon={<IoStop />}
                            size="md"
                            variant="outline"
                            onClick={() => {
                                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                                kill();
                            }}
                        />
                    </HStack>
                    <Spacer />
                    <HStack>
                        <SystemStats />
                        <DependencyManagerButton />
                        <SettingsButton />
                    </HStack>
                </Flex>
            </Box>
        </>
    );
};

export default memo(Header);
