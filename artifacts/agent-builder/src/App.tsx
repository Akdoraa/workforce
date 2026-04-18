import { useAgentStore } from "@/lib/store";
import {
  handleUserPrompt,
  connectStripe,
  toggleRunning,
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
  const hasStarted = !!agent && agent.phase !== "welcome";

  const handleSend = (text: string) => {
    if (!agent) return;
    handleUserPrompt({
      text,
      agent,
      updateAgent: store.updateAgent,
      addMessageTo: store.addMessageTo,
    });
  };

  const handleConnect = async () => {
    if (!agent) return;
    if (agent.service === "stripe") {
      await connectStripe({
        agent,
        updateAgent: store.updateAgent,
        addMessageTo: store.addMessageTo,
      });
    }
  };

  const handleToggleRunning = () => {
    if (!agent) return;
    toggleRunning({ agent, updateAgent: store.updateAgent });
  };

  const handleDisconnect = () => {
    if (!agent) return;
    disconnect({
      agent,
      updateAgent: store.updateAgent,
      addMessageTo: store.addMessageTo,
    });
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
                onSendMessage={handleSend}
                variant="compact"
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={48} minSize={30}>
              <RightPanel
                agent={agent}
                onConnect={handleConnect}
                onToggleRunning={handleToggleRunning}
                onDisconnect={handleDisconnect}
              />
            </ResizablePanel>
          </>
        ) : (
          <ResizablePanel defaultSize={84}>
            <ChatArea
              agent={agent}
              onSendMessage={handleSend}
              variant="welcome"
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
