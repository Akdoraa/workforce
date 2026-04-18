import { useAgentStore } from "@/lib/store";
import {
  handleUserPrompt,
  connectCredentials,
  disconnect,
} from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { RightPanel } from "@/components/RightPanel";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

function App() {
  const store = useAgentStore();
  const agent = store.currentAgent;
  const hasStarted = !!agent && agent.messages.length > 0;

  const onSend = (text: string) => {
    if (!agent) return;
    handleUserPrompt(text, agent, store.updateAgent, store.addMessageTo);
  };

  const onConnect = (apiKey: string, email: string) => {
    if (!agent) return;
    connectCredentials(
      agent,
      apiKey,
      email,
      store.updateAgent,
      store.addMessageTo,
    );
  };

  const onToggleRunning = () => {
    if (!agent) return;
    store.updateAgent(agent.id, { isRunning: !agent.isRunning });
  };

  const onDisconnect = () => {
    if (!agent) return;
    disconnect(agent, store.updateAgent);
  };

  return (
    <div className="h-screen w-full bg-background overflow-hidden text-foreground dark">
      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={16} minSize={12} maxSize={24}>
          <Sidebar onNewAgent={store.createNewAgent} />
        </ResizablePanel>
        <ResizableHandle />
        {hasStarted && agent ? (
          <>
            <ResizablePanel defaultSize={36} minSize={26} maxSize={55}>
              <ChatArea
                agent={agent}
                onSendMessage={onSend}
                variant="compact"
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={48} minSize={30}>
              <RightPanel
                agent={agent}
                onConnect={onConnect}
                onToggleRunning={onToggleRunning}
                onDisconnect={onDisconnect}
              />
            </ResizablePanel>
          </>
        ) : (
          <ResizablePanel defaultSize={84}>
            <ChatArea
              agent={agent}
              onSendMessage={onSend}
              variant="welcome"
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
