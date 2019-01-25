import {Partitions, JobChannels, TaskChannels, AdapterChannels, PoolChannels} from "protocol";
import {Platforms}  from "platforms";
import {TestComponent} from "testcomponents";
import {Task} from "task";
import {TestCaseResults} from "result";
import { Message, MessageTransport, TransportClient} from "messagetransport";
import { UniqueID } from "uniqueid";

export class Job extends UniqueID implements TransportClient
{
    protected tasks:Task[];
    protected results:TestCaseResults[];
    protected finished:boolean;
    constructor(
        public transport:MessageTransport,
        public build:string,
        public adapter_id:string, // Friendly name of generating source, Manual, Appveyor, Travis, etc
        public platforms:Platforms[], // List of platforms the job will run on
        public pool_id:string, // Pool to run the job in
        public storage_id:string, // URL or other path to storage for this task (artifacts)
        public tests:TestComponent[]) // List of tests to run for this job
    {
        super();
        // Subscribe to all (null) channels in the job partitions
        // with an address equal to ID
        this.tasks = [];
        this.results = [];
        this.transport.subscribe(this, Partitions.JOBS, null, this.id);
        this.finished = false;
    };

    public onMessage(message:Message)
    {
        if (message.partition == Partitions.JOBS)
        {
            this.handleJobMessage(message);
        }
        if (message.partition == Partitions.TASKS)
        {
            this.handleTaskMessage(message)
        }
    };

    public start()
    {
        for(let platform of this.platforms)
        {
            for(let test of this.tests)
            {
                let task = new Task({
                    build: this.build,
                    job_id: this.id,
                    worker_id: null,
                    platform: platform,
                    pool_id: this.pool_id,
                    storage_id: this.storage_id,
                    test: test.toJSON()});
                this.transport.subscribe(this, Partitions.TASKS, TaskChannels.RESULT, task.id);
                this.tasks.push(task);
            }
        }
        this.transport.sendMessage(
            Partitions.POOLS,
            PoolChannels.TASK,
            this.pool_id,
            this.tasks);
    };

    public abort()
    {
        this.finished = true;
        // For every task without a result
        // mark failed
        let pending_tasks = this.tasks.filter((t) => this.results.findIndex((r) => r.task == t) == -1);
        
        for(let task of pending_tasks)
        {
            task.abort(this.transport);
        }
    };

    protected handleTaskMessage(message:Message)
    {
        if (message.channel == TaskChannels.RESULT)
        {
            let result = new TestCaseResults(message.content);
            result.populateSkipped();
            this.addResult(result);
        }
    };

    protected addResult(result:TestCaseResults)
    {
        let index = this.tasks.findIndex((t) => t.id == result.task.id);
        if (index != -1)
        {
            this.transport.unsubscribe(this, Partitions.TASKS, TaskChannels.RESULT, result.task.id);
            this.results.push(result);
        }

        if (this.results.length == this.tasks.length)
        {
            this.finished = true;
            this.logResults();
        }
    };

    protected handleJobMessage(message:Message)
    {
        switch(message.channel)
        {
            case JobChannels.ABORT:
                this.abort();
            break;

            case JobChannels.START:
                this.start();
                break;

            case JobChannels.QUERY:
                this.transport.sendMessage(
                    Partitions.JOBS,
                    JobChannels.STATUS,
                    this.id,
                    this);
                break;
            default:
                break;
        };
    };

    public isFinished(): boolean
    {
        return this.finished;
    };

    public logResults()
    {
        this.transport.sendMessage(
            Partitions.ADAPTER,
            AdapterChannels.RESULT,
            this.adapter_id,
            this.results);
    };
};