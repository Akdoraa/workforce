import { useAgentStore } from "@/lib/store";
import { runBuilderTurn, deployFromBlueprint } from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { BlueprintPreview } from "@/components/BlueprintPreview";
import { DeployedAgentDashboard } from "@/components/DeployedAgent";
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
    void runBuilderTurn({
      agent,
      userText: text,
      updateAgent: store.updateAgent,
      addMessageTo: store.addMessageTo,
      appendToMessage: store.appendToMessage,
      patchBlueprint: store.patchBlueprint,
    });
  };

  const handleDeploy = () => {
    if (!agent) return;
    void deployFromBlueprint({
      agent,
      updateAgent: store.updateAgent,
      addMessageTo: store.addMessageTo,
    });
  };

  const handleClose = () => {
    if (!agent) return;
    store.updateAgent(agent.id, { phase: "welcome" });
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
              {agent.phase === "deployed" && agent.deploymentId ? (
                <DeployedAgentDashboard
                  deploymentId={agent.deploymentId}
                  onDisconnect={handleClose}
                />
              ) : (
                <BlueprintPreview
                  blueprint={agent.blueprint}
                  deploying={agent.status === "Deploying"}
                  onDeploy={handleDeploy}
                />
              )}
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
