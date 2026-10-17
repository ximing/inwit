/* Fictional, controlled M0 fixture. No external literature or user data. */
window.M0_DATA = (() => {
  const names = [['Task','任务','需要完成的目标与成功条件。'],['Trial','尝试','对一个任务的一次完整执行。'],['Step','步骤','一次尝试中的单个动作或决策。'],['Benchmark','基准','按统一协议组织的一组评测任务。'],['Grader','评判器','依据规则判定执行结果的过程。'],['Metric','指标','按明确口径汇总观测的统计量。'],['Agent','智能体','基于观察选择动作并执行任务的系统。'],['Environment','环境','提供观察并接受动作的运行上下文。'],['Tool','工具','供智能体调用的能力接口。'],['Trajectory','轨迹','一次执行中的观察、动作与结果序列。'],['Feedback','反馈','根据结果给出的修订信息。'],['Budget','预算','一次运行可消耗的资源上限。']];
  const concepts=names.map(([id,zh,definition],i)=>({id,zh,definition,note:`本文用 ${id} 解释代码修复测评；这是一份教学示例，不代表所有框架的统一术语。`,x:20+(i%3)*230,y:45+Math.floor(i/3)*180}));
  const chapterDefs=[
    ['从任务到尝试',[['Task','Task 规定要修复的缺陷与成功条件，不等于运行次数。'],['Trial','同一个 Task 运行五次，得到五个 Trial。Task 是目标，Trial 是一次执行。'],['Benchmark','Benchmark 将任务组织起来，约定一致的执行协议。']]],
    ['执行内部的结构',[['Trial','Trial 从环境初始化开始，到提交结果结束；一次尝试含多个 Step，并产生一份 Trajectory。'],['Step','Step 可以是读取文件、调用工具或提交补丁。'],['Trajectory','Trajectory 顺序记录这些步骤及观察，帮助重放一次执行。']]],
    ['智能体与工具',[['Agent','Agent 在 Environment 中运行，依据观察选择动作，调用 Tool 是动作的一种。'],['Tool','Tool 提供读文件、运行测试等接口；返回值仍需智能体解释。'],['Environment','Environment 响应 Step 中的动作并产生新的观察。']]],
    ['如何评判一次执行',[['Trial','每个 Trial 的补丁独立送交 Grader；五次尝试可能得到不同判定。'],['Grader','Grader 检查补丁是否通过测试；它判定结果而不是重新定义任务。'],['Feedback','Feedback 可以来自 Grader，将判定转成可用于修订的信息。']]],
    ['指标与统计口径',[['Metric','Metric 可以汇总 Grader 的判定，必须说明分母是任务数还是尝试数。'],['Benchmark','Metric 在指定 Benchmark 上报告；基准的任务集合和运行设置决定可比范围。']]],
    ['资源约束',[['Budget','Budget 约束一次 Trial 的资源，限制工具调用次数或令牌用量。'],['Tool','Tool 调用消耗预算；相同任务可在不同预算下运行。']]],
    ['反馈形成下一轮行动',[['Feedback','Feedback 指导 Agent 调整行动，Agent 再通过 Tool 获取新结果。'],['Agent','Agent 调用 Tool，Tool 返回 Feedback，Feedback 指导 Agent；这是跨类型的合法环。']]],
    ['复现与审慎比较',[['Trajectory','Trajectory 记录执行证据，帮助解释成功或失败，而不是替代判定。'],['Metric','Benchmark 约定 Budget；报告 Metric 时同时注明 Budget、Benchmark 与判定规则。更高数值未必代表更强能力。']]]
  ];
  let n=0;
  const chapters=chapterDefs.map(([title,rows],i)=>({id:`ch${i+1}`,title,marks:rows.map(([concept,quote])=>({id:`h${++n}`,concept,quote}))}));
  const specs=[['Task','Trial','可以进行多次',1],['Trial','Step','由多个步骤构成',2],['Benchmark','Task','组织任务集合',1],['Grader','Trial','评判尝试结果',4],['Metric','Grader','汇总判定',5],['Metric','Benchmark','在指定基准上报告',5],['Agent','Tool','调用',3],['Tool','Feedback','返回',7],['Feedback','Agent','指导下一步',7],['Agent','Environment','在其中运行',3],['Environment','Step','响应动作',3],['Trajectory','Step','按序记录',2],['Trial','Trajectory','产生',2],['Budget','Trial','约束资源',6],['Tool','Budget','消耗',6],['Feedback','Grader','可来自',4],['Benchmark','Budget','约定',8],['Metric','Budget','需要注明',8]];
  const relations=specs.map(([from,to,predicate,ch],i)=>({id:`r${i+1}`,from,to,predicate,explanation:i===0?'Task 是要完成的任务，Trial 是它的一次执行。重复运行不增加 Task 数量。':`在本文的代码修复语境中，${from} ${predicate} ${to}。方向表达这一具体作用，并不表示通用的先后依赖。`,example:i===0?'修复同一个缺陷运行五次：1 个 Task，5 个 Trial。':`以修复一个解析错误为例，结合第 ${ch} 章的过程理解这条联系。`,source:chapters[ch-1].marks[0].id}));
  ['h2','h4','h3','h10','h13','h14','h7','h18','h18','h7','h9','h6','h4','h15','h16','h12','h20','h20'].forEach((source,i)=>relations[i].source=source);
  const cards=Array.from({length:15},(_,i)=>({id:`card${i+1}`,chapter:chapters[i%8].id,concepts:i===0?['Task','Trial']: [concepts[i%12].id,concepts[(i+1)%12].id],primary:i===0?'r1':concepts[i%12].id,text:i===0?'同一任务运行五次，有几个 Task、几个 Trial？':`解释 ${concepts[i%12].id}，并给出一个代码修复中的例子。`}));
  return {concepts,relations,chapters,cards};
})();
