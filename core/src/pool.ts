import {TaskStatus, Task} from "common/task";
import {WorkerState, Worker} from "common/worker";
import {Partitions, WorkerChannels, PoolChannels, TaskChannels } from "common/protocol";
import {Message, MessageTransport, TransportClient, ArrayFromJSON } from "common/messagetransport";

export class Pool implements TransportClient
{
    protected queued_tasks:Task[];
    protected active_tasks:Task[];
    protected pending_tasks:Task[];
    protected query_timer:number;
    protected query_interval:number;
    protected PENDING_TIMEOUT:number;
    public workers:Worker[];

    constructor(
        public id:string,
        public transport:MessageTransport,
        public limit:number)
    {
        this.PENDING_TIMEOUT = 15000;
        this.transport.subscribe(
            this,
            Partitions.POOLS,
            null,
            this.id);
        this.transport.subscribe(
            this,
            Partitions.WORKERS,
            null,
            null);
        this.transport.subscribe(
            this,
            Partitions.TASKS,
            TaskChannels.RESULT,
            null);
        this.transport.subscribe(
            this,
            Partitions.TASKS,
            TaskChannels.ABORT,
            null);
        this.queued_tasks = [];
        this.active_tasks = [];
        this.pending_tasks = [];
        this.workers = [];
        this.query_timer = new Date().getTime();
        this.query_interval = 180000;
    };

    public onMessage(message:Message)
    {
      switch(message.partition)
        {
            case Partitions.POOLS:
                this.handlePoolMessage(message);
                break;
            case Partitions.WORKERS:
                this.handleWorkerMessage(message);
                break;
            case Partitions.TASKS:
                this.handleTaskMessage(message);
                break;
            default:
                break;
        }
    };

    public handleTaskMessage(message:Message)
    {
        switch(message.channel)
        {
            case TaskChannels.ABORT:
                {
                    let index = this.queued_tasks.findIndex((task) => task.id == message.address);
                    if (index != -1)
                    {
                        this.queued_tasks.splice(index, 1);
                    }
                }
                {
                    let index = this.active_tasks.findIndex((task)=> task.id == message.address);
                    if (index != -1)
                    {
                        this.active_tasks.splice(index, 1);
                    }
                }
                break;
            case TaskChannels.RESULT:
                {
                    let index = this.active_tasks.findIndex((task)=> task.id == message.address);
                    if (index != -1)
                    {
                        this.active_tasks.splice(index, 1);
                    }
                }
                break;
            default:
                break;
        }
    }

    public handlePoolMessage(message:Message)
    {
        switch(message.channel)
        {
            case PoolChannels.QUERY:
                this.transport.sendMessage(
                    Partitions.POOLS,
                    PoolChannels.STATUS,
                    this.id,
                    {
                        pending_task_count: this.pending_tasks.length,
                        active_task_count: this.active_tasks.length,
                        queued_task_count: this.queued_tasks.length,
                        workers: this.workers.map((worker:Worker) => {
                            return {
                                id: worker.id,
                                platform: worker.platform,
                                state: worker.state,
                                task: worker.task.toJSON(),
                                pool_id: worker.pool_id
                                };
                        }),
                        id: this.id,
                        limit: this.limit
                    });
                break;
            case PoolChannels.TASK:
                this.addTasks(ArrayFromJSON<Task>(Task, message.content));
                break;
            default:
                break;
        }
    }

    public handleWorkerMessage(message:Message)
    {
        switch(message.channel)
        {
            case WorkerChannels.STATUS:
                // Check that worker still belongs to us
                // otherwise remove
                {
                    let worker = null;
                    let index = this.workers.findIndex((w) => w.id == message.address);
                    if (typeof(message.content.pool_id) != 'undefined')
                    {
                        if (index != -1)
                        {
                            worker = this.workers[index];
                            if(message.content.pool_id != this.id)
                            {
                                this.removeWorker(this.workers[index]);
                            }
                        } else {
                            if (message.content.pool_id == this.id)
                            {
                                this.discoverWorker(message);
                            }
                        }
                    }
                    if (worker == null)
                    {
                        break;
                    }
                    // If Worker has active tasks and isn't busy
                    // this might happen if a worker resets in the middle of a job
                    if (worker.state != WorkerState.BUSY)
                    {
                        index = this.active_tasks.findIndex((task) => task.worker_id == worker.id);
                        if (index != -1)
                        {
                            let task = this.active_tasks[index];
                            task.worker_id = null;
                            this.queued_tasks.push(task);
                            this.active_tasks.splice(index, 1);
                        }
                    }
                }
                break;
            case WorkerChannels.ACCEPT:
                // Move task from pending to active
                {
                    let task = null;
                    let index = this.pending_tasks.findIndex((task) => task.id == message.content.task_id);
                    if (index != -1)
                    {
                        task = this.pending_tasks[index];
                        this.active_tasks.push(task);
                        this.pending_tasks.splice(index, 1);
                    }
                    if (task != null) {
                        task.status = TaskStatus.RUNNING;
                        this.transport.sendMessage(
                            Partitions.TASKS,
                            TaskChannels.STATUS,
                            task.id,
                            task.toJSON());
                    }
                }
                break;
            case WorkerChannels.REJECT:
                // Move task back into queue
                {
                    let index = this.pending_tasks.findIndex((task) => task.id == message.content.task_id);
                    if (index != -1)
                    {
                        this.queued_tasks.push(this.pending_tasks[index]);
                        this.pending_tasks.splice(index, 1);
                    }
                    index = this.active_tasks.findIndex((task) => task.id == message.content.task_id);
                    if (index != -1)
                    {
                        this.queued_tasks.push(this.active_tasks[index]);
                        this.active_tasks.splice(index, 1);
                    }
                }
                break;
            default:
                break;
        }
    }

    public discoverWorker(message:Message)
    {
        let selected_worker:Worker = null;
        for (let worker of this.workers)
        {
            if (worker.id == message.address)
            {
                selected_worker = worker;
                let rejected = [];
                this.active_tasks = this.active_tasks.filter((task) =>
                {
                    if (task.worker_id == worker.id)
                    {
                        rejected.push(task);
                        return false;
                    }
                    return true;
                });
                this.queued_tasks.concat(rejected);
                rejected = [];
                this.pending_tasks = this.pending_tasks.filter((task) => {
                    if (task.worker_id == worker.id)
                    {
                        rejected.push(task);
                        return false;
                    }
                    return true;
                });
                this.queued_tasks.concat(rejected);
                break;
            }
        }
        if (!selected_worker)
        {
            selected_worker = new Worker(
                message.address,
                this.id,
                message.content.platform,
                this.transport,
                180000);
            this.addWorker(selected_worker);
        }
        selected_worker.state = message.content.state || WorkerState.IDLE;
        selected_worker.platform = message.content.platform || selected_worker.platform;
        this.transport.sendMessage(
            Partitions.WORKERS,
            WorkerChannels.CONFIG,
            selected_worker.id,
            {
                "pool_id": this.id
            });
    };

    public addWorker(worker:Worker)
    {
        if (this.workers.findIndex((w) => (w.id == worker.id)) == -1)
        {
            worker.pool_id = this.id;
            this.workers.push(worker);
        }
    };

    public removeWorker(worker:Worker)
    {
        let index = this.workers.findIndex((w) => worker.id == w.id);
        if (index != -1)
        {
            worker.destroy();
            this.workers.splice(index, 1);
        }
    };

    public addTasks(tasks:Task[])
    {
        for(let task of tasks)
        {
            task.pool_id = this.id;
        }
        this.queued_tasks = this.queued_tasks.concat(tasks);
    };

    public getPlatformTask(worker:Worker):Task
    {
        let index = this.queued_tasks.findIndex((t)=> t.platform == worker.platform);
        if (index == -1)
        {
            return null;
        }
        let task = this.queued_tasks[index];
        this.queued_tasks.splice(index, 1);
        return task;
    };

    public queueSize():number
    {
        return this.queued_tasks.length;
    };

    public activeCount():number
    {
        return this.active_tasks.length;
    };

    public process()
    {
        if ((new Date().getTime() - this.query_timer) > this.query_interval)
        {
            this.query_timer = new Date().getTime();
            this.transport.sendMessage(
                Partitions.WORKERS,
                WorkerChannels.QUERY,
                null,
                { "pool_id": this.id});
        }
        // Dequeue tasks to idle workers until we run out of one or the other
        for(let worker of this.workers)
        {
            if (worker.state == WorkerState.IDLE)
            {
                let task = this.getPlatformTask(worker);
                if (task == null || task == undefined)
                {
                    continue;
                }

                worker.setTask(task);
                this.pending_tasks.push(task);
                setTimeout(() => {
                    let index = this.pending_tasks.findIndex((what) => what.id == task.id);
                    if(index != -1)
                    {
                        worker.error();
                        this.queued_tasks.push(this.pending_tasks[index]);
                        this.pending_tasks.splice(index, 1);
                    } 
                }, this.PENDING_TIMEOUT);
            }
        }
    };

    public statusPayload()
    {
        let payload = {
            queued_tasks: this.queued_tasks,
            active_tasks: this.active_tasks,
            pending_tasks: this.pending_tasks,
            id: this.id,
            workers: []
        };

        console.log(`Pool ${this.id} Queued: ${this.queued_tasks.length} Pending: ${this.pending_tasks.length} Active: ${this.active_tasks.length}`);

        for(let worker of this.workers)
        {
            payload.workers.push(worker.statusPayload());
        }

        return payload;
    };
};
