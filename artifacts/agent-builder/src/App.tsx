import { useState } from "react";
import { useAgentStore } from "@/lib/store";
import { runBuilderTurn, deployFromBlueprint } from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { BlueprintPreview } from "@/components/BlueprintPreview";
import { DeployedAgentDashboard } from "@/components/DeployedAgent";
import { Button } from "@/components/ui/button";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

function App() {
  const store = useAgentStore();
  const agent = store.currentAgent;
  const hasStarted = !!agent && agent.phase !== "welcome";
  const [dashboardHidden, setDashboardHidden] = useState(false);

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

  const showDashboard = hasStarted && !dashboardHidden;

  return (
    <div className="h-screen w-full bg-background overflow-hidden text-foreground relative">
      {hasStarted ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDashboardHidden((v) => !v)}
          className="absolute top-3 right-3 z-50 h-8 gap-1.5 shadow-sm bg-background"
          title={dashboardHidden ? "Show dashboard" : "Hide dashboard"}
        >
          {dashboardHidden ? (
            <>
              <PanelRightOpen className="h-3.5 w-3.5" /> Show dashboard
            </>
          ) : (
            <>
              <PanelRightClose className="h-3.5 w-3.5" /> Hide dashboard
            </>
          )}
        </Button>
      ) : null}

      <ResizablePanelGroup direction="horizontal" className="h-full w-full">
        <ResizablePanel defaultSize={16} minSize={12} maxSize={24}>
          <Sidebar onNewAgent={store.createNewAgent} />
        </ResizablePanel>
        <ResizableHandle />
        {showDashboard && agent ? (
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
              variant={hasStarted ? "compact" : "welcome"}
            />
          </ResizablePanel>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

export default App;
